// Makes the super admin's password and the line that goes into the host's settings as SUPER_ADMIN_PASSWORD_HASH.
//
//   npm run hash-password            makes a random password, shows it once, and puts the hash on the clipboard
//   npm run hash-password -- --own   asks you to type your own (at least 12 characters, not shown as you type)
//   --no-copy                        does not touch the clipboard
//
// The password is never saved anywhere. Only the hash is kept, and it cannot be turned back into the password.
import { spawnSync } from "node:child_process";
import { generatePassword, hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "../src/server/password.ts";

const args = new Set(process.argv.slice(2));

/** Reads a line without showing it. Needs a real terminal. */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("Run this in a terminal window, not through a pipe."));
    process.stdout.write(prompt);
    let typed = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(typed);
        } else if (ch === "\u007f" || ch === "\b") {
          typed = typed.slice(0, -1);
        } else {
          typed += ch;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function choose() {
  if (!args.has("--own")) return { password: generatePassword(), generated: true };
  const first = await ask("New password: ");
  if (first.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (first.length > MAX_PASSWORD_LENGTH) throw new Error(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  if ((await ask("Type it again: ")) !== first) throw new Error("The two did not match. Nothing was made.");
  return { password: first, generated: false };
}

try {
  const { password, generated } = await choose();
  const hash = await hashPassword(password);

  let copied = false;
  if (!args.has("--no-copy") && process.platform === "darwin") {
    copied = spawnSync("pbcopy", { input: hash }).status === 0;
  }

  console.log("");
  if (generated) {
    console.log("Your super admin password. Write it down or keep it in a password manager. It is not saved anywhere:");
    console.log("");
    console.log(`    ${password}`);
    console.log("");
  }
  console.log("The line for SUPER_ADMIN_PASSWORD_HASH in the host's settings:");
  console.log("");
  console.log(`    ${hash}`);
  console.log("");
  console.log(copied ? "That line is on your clipboard now." : "Copy that whole line.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
