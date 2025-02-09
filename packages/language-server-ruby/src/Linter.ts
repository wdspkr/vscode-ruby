import URI from 'vscode-uri';
import { iif, from, forkJoin, of, Observable } from 'rxjs';
import { map, mergeMap, switchMap } from 'rxjs/operators';
import { Diagnostic, TextDocument } from 'vscode-languageserver';
import {
	documentConfigurationCache,
	IEnvironment,
	workspaceRubyEnvironmentCache,
	RubyConfiguration,
	RubyCommandConfiguration,
} from './SettingsCache';
import { ILinter, LinterConfig, RuboCop, Reek, Standard, NullLinter } from './linters';
import { documents, DocumentEvent, DocumentEventKind } from './DocumentManager';

const LINTER_MAP = {
	rubocop: RuboCop,
	reek: Reek,
	standard: Standard,
};

export interface LintResult {
	document: TextDocument;
	diagnostics: Diagnostic[];
	error?: string;
}

function getLinter(
	name: string,
	document: TextDocument,
	env: IEnvironment,
	config: RubyConfiguration
): ILinter {
	const linter = LINTER_MAP[name];
	if (!linter) return new NullLinter(name);
	const lintConfig: RubyCommandConfiguration =
		typeof config.lint[name] === 'object' ? config.lint[name] : {};
	const linterConfig: LinterConfig = {
		env,
		executionRoot: URI.parse(config.workspaceFolderUri).fsPath,
		config: lintConfig,
	};
	return new linter(document, linterConfig);
}

function lint(document: TextDocument): Observable<LintResult> {
	return from(documentConfigurationCache.get(document)).pipe(
		mergeMap(config => {
			return from(workspaceRubyEnvironmentCache.get(config.workspaceFolderUri)).pipe(
				map(env => {
					return { config, env };
				})
			);
		}),
		mergeMap(({ config, env }) => {
			const linters = Object.keys(config.lint)
				.filter(l => config.lint[l] !== false)
				.map(l => getLinter(l, document, env, config).lint());
			return forkJoin(linters).pipe(
				map(diagnostics => {
					return {
						document,
						diagnostics: [].concat(...diagnostics),
					};
				})
			);
		})
	);
}

export const linter = documents.subject.pipe(
	switchMap((event: DocumentEvent) =>
		iif(
			() =>
				event.kind === DocumentEventKind.OPEN || event.kind === DocumentEventKind.CHANGE_CONTENT,
			lint(event.document),
			of({
				document: event.document,
				diagnostics: [],
			})
		)
	)
);
