import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { dirname } from 'path';

const CLANG_FORMAT_CODE = 'cfc';

const diagnosticReplacements = new Map<string, string[]>();

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('cpp', new ClangFormatFixer(), {
			providedCodeActionKinds: ClangFormatFixer.providedCodeActionKinds
		}));

	const cfcDiagnostics = vscode.languages.createDiagnosticCollection("clang-format-checker");
	context.subscriptions.push(cfcDiagnostics);

	subscribeToDocumentChanges(context, cfcDiagnostics);

	const checkCommand = vscode.commands.registerCommand('clang-format-checker.checkCode', () => {
		let activeTextEditor = vscode.window.activeTextEditor;
		if (activeTextEditor) {
			doCheckCode(activeTextEditor.document, cfcDiagnostics);
		}
	});
	context.subscriptions.push(checkCommand);



	const clearCommand = vscode.commands.registerCommand('clang-format-checker.clear', () => {
		cfcDiagnostics.clear();
	});
	context.subscriptions.push(clearCommand);
}

function doCheckCode(doc: vscode.TextDocument, cfcDiagnostics: vscode.DiagnosticCollection): void {
	try {
		const clangFormatExec = vscode.workspace.getConfiguration('clang-format-checker').get('clangFormatExecutable');

		const result = execSync(
			`${clangFormatExec} --style=file --fallback-style=none --output-replacements-xml`,
			{
				stdio: 'pipe',
				cwd: dirname(doc.uri.fsPath),
				input: doc.getText()
			}).toString();
		refreshDiagnostics(result, doc, cfcDiagnostics);
	}
	catch (e) {
		vscode.window.showErrorMessage((<Error>e).message);
	}
}

function refreshDiagnostics(result: string, doc: vscode.TextDocument, cfcDiagnostics: vscode.DiagnosticCollection): void {
	const diagnostics: vscode.Diagnostic[] = [];
	const replacements: string[] = [];
	let code = 0;
	const regExp = /<replacement\soffset='(\d+)'\slength='(\d+)'>(.*)<\/replacement>/i;
	result.split('\n').forEach(line => {
		if (line.startsWith('<replacement offset')) {
			const matchArray: RegExpMatchArray | null = line.match(regExp);
			if (matchArray) {
				const offset = parseInt(matchArray[1]);
				const length = parseInt(matchArray[2]);
				let replacement = matchArray[3];

				replacement = replacement.replace(/&#13;/g, '\r');
				replacement = replacement.replace(/&#10;/g, '\n');
				replacement = replacement.replace(/&lt;/g, '<');

				const startPos = doc.positionAt(offset);
				const endPos = doc.positionAt(offset + length);
				const range = new vscode.Range(startPos, endPos);
				diagnostics.push({
					code: code,
					message: getFormatMessage(replacement, length, doc.getText(range)),
					range: range,
					severity: vscode.DiagnosticSeverity.Warning,
					source: 'clang-format-checker'
				});
				replacements.push(replacement);
				code++;
			}
		}
	});

	cfcDiagnostics.set(doc.uri, diagnostics);
	diagnosticReplacements.set(doc.uri.toString(), replacements);
}

function getFormatMessage(replacement: string, length: number, replacedText: string): string {
	if (replacement === '') {
		if (replacedText.startsWith('\r\n') || replacedText.startsWith('\n')) {
			return "Remove unnecessary new-line(s).";
		} else {
			return 'Remove spacing.';
		}
	} else if (replacement === ' ') {
		if (length === 0) {
			return 'Add space.';
		} else if (replacedText.startsWith('\r\n') || replacedText.startsWith('\n')) {
			return "Remove unnecessary new-line(s).";
		} else {
			return 'Remove spacing.';
		}
	} else if (replacement.startsWith('\r\n') || replacement.startsWith('\n')) {
		if (length === 0) {
			return "Add new line.";
		}

		if (replacedText.charAt(0) === ' ') {
			return "Remove trailing space(s).";
		}

		// there is a case where new line is being replaced with new line + spacing
		if (replacement.startsWith(replacedText)) {
			return getFormatMessage(replacement.substring(replacedText.length), 0, '');
		}
		if (replacedText.startsWith(replacement)) {
			return getFormatMessage('', length - replacedText.length, replacedText.substring(replacement.length));
		}
	}
	else if (replacement.startsWith('#include')) {
		return "Reogranize #include-s.";
	}

	const trimmed = replacement.trim();
	if (trimmed.length === 0) {
		if (replacement.length > length) {
			return "Missing spacing.";
		} else if (replacedText.startsWith('\r\n') || replacedText.startsWith('\n')) {
			return "Remove unnecessary new-line(s).";
		}
	} 

	// fallback
	return "Re-format needed.";
}

let timeout: NodeJS.Timeout | undefined = undefined;

function scheduleCodeCheck(doc: vscode.TextDocument, cfcDiagnostics: vscode.DiagnosticCollection): void {
	if (timeout) {
		clearTimeout(timeout);
		timeout = undefined;
	}
	timeout = setTimeout(doCheckCode, 1500, doc, cfcDiagnostics);
}


function subscribeToDocumentChanges(context: vscode.ExtensionContext, cfcDiagnostics: vscode.DiagnosticCollection): void {
	let doCheckOnChange: boolean = true;
	
	// document already open case
	if (doCheckOnChange && vscode.window.activeTextEditor) {
		scheduleCodeCheck(vscode.window.activeTextEditor.document, cfcDiagnostics);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && doCheckOnChange) {
				doCheckCode(editor.document, cfcDiagnostics);
			}
		})
	);

	if (doCheckOnChange) {
		context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument(e => scheduleCodeCheck(e.document, cfcDiagnostics))
		);
	}

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(doc => {
			cfcDiagnostics.delete(doc.uri);
			diagnosticReplacements.delete(doc.uri.toString());
		})
	);

}

class ClangFormatFixer implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
		return this.createFixActions(document, context.diagnostics);
	}

	private createFixActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const actions : vscode.CodeAction[] = [];
		if (diagnostics.length === 0) {
			return actions;
		}

		//let adjustment = 0;
		let replacementsForDocument = diagnosticReplacements.get(document.uri.toString());
		if (replacementsForDocument) {
			const fix = new vscode.CodeAction('Reformat selected', vscode.CodeActionKind.QuickFix);
			if (diagnostics.length === 1) {
				fix.title = diagnostics[0].message;
			} 
			fix.diagnostics = diagnostics.slice();
			fix.edit = new vscode.WorkspaceEdit();
			fix.isPreferred = true;
			// we assume that multiple edits are handled by VSCode (i.e. offsets)
			// if not, the idea is to do fixes from the end of the document to the begginning
			diagnostics.forEach(diagnostic => {
				const rs = replacementsForDocument as string[];
				const replacement = rs[diagnostic.code as number];
				fix?.edit?.replace(document.uri, diagnostic.range, replacement);
			});
			actions.push(fix);
		}
		return actions;
	}
}

// this method is called when your extension is deactivated
export function deactivate() {
	diagnosticReplacements.clear();
}
