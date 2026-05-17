const vscode = require('vscode');

async function test() {
    const left = vscode.Uri.parse('empty:stash_test_4.js');
    const right = vscode.Uri.file(__dirname + '/stash_test_4.js');
    // Try to open diff
    await vscode.commands.executeCommand('vscode.diff', left, right, 'Test Diff');
}
module.exports = test;
