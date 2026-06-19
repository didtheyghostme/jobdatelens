const assert = require("node:assert/strict");
const test = require("node:test");

const background = require("../background.js");

test("detects when the execute action shortcut is unassigned", () => {
  assert.equal(
    background.isCommandShortcutUnassigned(
      [
        {
          name: background.EXECUTE_ACTION_COMMAND,
          shortcut: ""
        }
      ],
      background.EXECUTE_ACTION_COMMAND
    ),
    true
  );
});

test("does not treat an assigned execute action shortcut as unassigned", () => {
  assert.equal(
    background.isCommandShortcutUnassigned(
      [
        {
          name: background.EXECUTE_ACTION_COMMAND,
          shortcut: "Command+Shift+E"
        }
      ],
      background.EXECUTE_ACTION_COMMAND
    ),
    false
  );
});

test("ignores unassigned shortcuts for other commands", () => {
  assert.equal(
    background.isCommandShortcutUnassigned(
      [
        {
          name: "other-command",
          shortcut: ""
        }
      ],
      background.EXECUTE_ACTION_COMMAND
    ),
    false
  );
});

test("does not infer an unassigned shortcut when the command is missing", () => {
  assert.equal(
    background.isCommandShortcutUnassigned([], background.EXECUTE_ACTION_COMMAND),
    false
  );
  assert.equal(
    background.isCommandShortcutUnassigned(null, background.EXECUTE_ACTION_COMMAND),
    false
  );
});
