const vscode = require('vscode');
async function test() {
  const cmds = await vscode.commands.getCommands(true);
  console.log(cmds.filter(c => c.startsWith('git.open')));
}
module.exports = test;
