import assert from 'assert';
import pkg = require('../../package.json');

describe('package contributions', () => {
  it('shows stash-file quick actions inline in the sidebar', () => {
    const menuItems = pkg.contributes.menus['view/item/context'] as Array<{
      command: string;
      when: string;
      group: string;
    }>;

    const stashFileInlineCommands = menuItems
      .filter((item) => item.when === 'view == stasher.stashList && viewItem == stashFile')
      .filter((item) => item.group.startsWith('inline'))
      .map((item) => item.command)
      .sort();

    assert.deepStrictEqual(stashFileInlineCommands, [
      'stasher.deleteFileFromStash',
      'stasher.moveFileToStash',
      'stasher.unstashThisFile',
    ]);
  });

  it('uses the same inline button group style as unstash-this-file', () => {
    const menuItems = pkg.contributes.menus['view/item/context'] as Array<{
      command: string;
      when: string;
      group: string;
    }>;

    const inlineButtons = menuItems.filter(
      (item) =>
        item.when === 'view == stasher.stashList && viewItem == stashFile' &&
        ['stasher.unstashThisFile', 'stasher.moveFileToStash', 'stasher.deleteFileFromStash'].includes(item.command)
    );

    assert.ok(inlineButtons.length === 3);
    assert.ok(inlineButtons.every((item) => item.group === 'inline'));
  });
});
