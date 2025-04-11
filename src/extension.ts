import * as vscode from 'vscode';
import axios from 'axios';  // Axios import

const GOOGLE_API_KEY = 'AIzaSyCLNEqlvrqvoGnHrOjZZNy5Pw9a9q_PGDg';
const GOOGLE_SEARCH_ENGINE_ID = '16318ce58ae09495c';

let webviewPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('ScrapFixes extension is now active!');

    const disposable = vscode.commands.registerCommand('scrapfixes.detectBugs', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document) {
            vscode.window.showErrorMessage('No active file open. Please open a file and try again.');
            return;
        }

        const document = editor.document;
        const language = document.languageId;

        console.log(`Analyzing code in language: ${language}`);
        vscode.window.showInformationMessage(`Analyzing code in detected language: ${language}`);

        try {
            const terminalErrors = getProblemsTabErrors();
            console.log('Fetched terminal errors:', terminalErrors);

            if (terminalErrors.length === 0) {
                vscode.window.showInformationMessage('No errors detected in the Problems panel.');
                return;
            }

            const webSolutions = await searchWebSolutions(terminalErrors, language);
            await showFixesPanel(terminalErrors, webSolutions, language);
        } catch (error) {
            console.error('Error fetching errors:', error);
            vscode.window.showErrorMessage(`Error fetching errors: ${(error as Error).message}`);
        }
    });

    context.subscriptions.push(disposable);
}

function getProblemsTabErrors(): string[] {
    const allDiagnostics = vscode.languages.getDiagnostics();
    return allDiagnostics
        .filter(([_, diagnostics]) => diagnostics.length > 0)
        .flatMap(([uri, diagnostics]) =>
            diagnostics
                .filter(diag => diag.severity === vscode.DiagnosticSeverity.Error)
                .map(diag => `${diag.message} (File: ${uri.fsPath}, Line: ${diag.range.start.line + 1})`)
        );
}

async function searchWebSolutions(errors: string[], language: string): Promise<{ error: string, solutions: { snippet: string, link: string }[] }[]> {
    const results: { error: string, solutions: { snippet: string, link: string }[] }[] = [];

    if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
        vscode.window.showErrorMessage('Google API key or Search Engine ID not set.');
        return errors.map(error => ({
            error,
            solutions: [{ snippet: 'API credentials not set.', link: '#' }]
        }));
    }

    for (const error of errors) {
        try {
            const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
                params: {
                    q: `${error} solution in ${language} programming`,
                    key: GOOGLE_API_KEY,
                    cx: GOOGLE_SEARCH_ENGINE_ID
                }
            });

            if (response.status === 200) {
                const items = response.data?.items;
                const solutions = Array.isArray(items)
                    ? items.map((item: any) => ({
                        snippet: item.snippet || 'No snippet available',
                        link: item.link || '#'
                    }))
                    : [];

                results.push({
                    error,
                    solutions: solutions.length > 0 ? solutions : [{ snippet: 'No solutions found online.', link: '#' }]
                });
            } else {
                console.error(`Google API Error: Received status code ${response.status}`);
                results.push({
                    error,
                    solutions: [{ snippet: `Error fetching solutions (status code: ${response.status})`, link: '#' }]
                });
            }
        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                if (error.response) {
                    console.error(`Error response from Google API: ${error.response.status}`);
                    console.error(`Response data: ${JSON.stringify(error.response.data)}`);
                    results.push({
                        error: error.message,
                        solutions: [{
                            snippet: `API Error: ${error.response?.data?.error?.message || 'Unknown error'}`,
                            link: '#'
                        }]
                    });
                } else if (error.request) {
                    console.error(`No response received from Google API. Request: ${error.request}`);
                    results.push({
                        error: error.message,
                        solutions: [{ snippet: 'No response received from the API.', link: '#' }]
                    });
                } else {
                    console.error(`Axios error message: ${error.message}`);
                    results.push({
                        error: error.message,
                        solutions: [{ snippet: `Axios error: ${error.message}`, link: '#' }]
                    });
                }
            } else {
                console.error('An unexpected error occurred:', error);
                results.push({
                    error: 'Unknown error',
                    solutions: [{ snippet: 'An unexpected error occurred while fetching solutions.', link: '#' }]
                });
            }
        }
    }

    return results;
}

async function showFixesPanel(
    errors: string[],
    results: { error: string, solutions: { snippet: string, link: string }[] }[],
    language: string
): Promise<void> {
    if (!webviewPanel) {
        webviewPanel = vscode.window.createWebviewPanel(
            'bugFixesPanel',
            'Bug Fixes',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
    }

    let content = `<h2>Detected Errors and Possible Fixes</h2>`;
    content += `<p><b>Detected Language:</b> ${language}</p>`;
    content += `<p><b>Total Errors Detected:</b> ${errors.length}</p>`;

    if (errors.length > 0) {
        content += errors.map((error, index) => {
            return `<div>
                        <p><b>Error ${index + 1}:</b> <code>${error}</code></p>
                        <details>
                            <summary>Possible Fixes</summary>
                            <ul>
                                ${results[index].solutions.map(({ snippet, link }) => 
                                    `<li><p>${snippet}</p><a href="#" class="solution-link" data-link="${link}">View Full Solution</a></li>`
                                ).join('')}
                            </ul>
                        </details>
                    </div>`;
        }).join('');
    } else {
        content += '<p>No solutions found online.</p>';
    }

    webviewPanel.webview.html = `
        <html>
        <body>
            ${content}
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('.solution-link').forEach(anchor => {
                    anchor.addEventListener('click', event => {
                        event.preventDefault();
                        const url = event.target.getAttribute('data-link');
                        vscode.postMessage({ command: 'openWebView', url });
                    });
                });
            </script>
        </body>
        </html>`;

    webviewPanel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'openWebView') {
            const solutionPanel = vscode.window.createWebviewPanel(
                'solutionView',
                'Solution View',
                webviewPanel?.viewColumn ?? vscode.ViewColumn.Active,
                { enableScripts: true }
            );

            try {
                const response = await axios.get(message.url);
                const baseTag = `<base href="${message.url}">`;
                const pageContent = response.data.replace(/<head>/i, `<head>${baseTag}`);
                solutionPanel.webview.html = `<html><body>${pageContent}</body></html>`;
            } catch (error) {
                const err = error as Error;
                solutionPanel.webview.html = `<html><body><p>Error loading solution: ${err.message}</p></body></html>`;
            }
        }
    });

    webviewPanel.onDidDispose(() => {
        webviewPanel = undefined;
    });
}

export function deactivate() {}
