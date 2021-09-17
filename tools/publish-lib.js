/**
 * Create one JS library per tag and commit the result to the gh-pages branch
 * 
 * node tools/publish-tags.js
 */

const util = require('util');
const fs = require('fs');
const semver = require('semver');
const execFile = util.promisify(require('child_process').execFile);

const lib = 'i-slide';

async function writeLib(ref, filename) {
  filename = filename || `${lib}-${ref}`;
  const { stdout: showOut } = await execFile('git', ['show', `${ref}:${lib}.js`]);
  fs.writeFileSync(`${filename}.js`, showOut, 'utf8');
}

async function main() {
  console.log('Retrieve list of tags...');
  const { stdout: tagOut } = await execFile('git', ['tag', '--sort=-v:refname']);
  const tags = tagOut.split(/[\r\n]/)
    .filter(tag => !!tag)
    .filter(tag => semver.valid(semver.clean(tag)));
  const lastTag = tags[0] ?? 'main';
  console.log(`  ${tags.length} tags found`);

  console.log('Find major versions...');
  const majorVersions = tags
    .map(tag => Object.assign({
      major: semver.major(semver.clean(tag)),
      tag
    }))
    .filter((item, pos, arr) =>
      item.major !== null &&
      arr.find(i => i.major === item.major) === item);
  if (majorVersions.length) {
    majorVersions.forEach(m => console.log(`  ${m.major} => ${m.tag}`));
  }
  else {
    console.log('  no major version found');
  }

  console.log('Lookup name of current branch...');
  const { stdout: branchOut } = await execFile('git', ['branch', '--show-current']);
  const branchName = branchOut.trim();
  console.log(`  on branch ${branchName}`);

  console.log('Switch to gh-pages branch...');
  const { stdout: checkOut } = await execFile('git', ['checkout', 'gh-pages']);
  console.log('  done');

  console.log('Create one lib file per tag...');
  for (const tag of tags) {
    await writeLib(tag, `${lib}-${semver.clean(tag)}`);
  }
  console.log('  done');

  console.log('Create one lib file per major version...');
  for (const version of majorVersions) {
    await writeLib(version.tag, `${lib}-${version.major}`);
  }
  console.log('  done');

  console.log('Add latest release...')
  await writeLib(lastTag, lib);
  console.log('  done');

  console.log('Add nightly version from main branch...')
  await writeLib('main', `${lib}-nightly`);
  console.log('  done');

  console.log('Update README and LICENSE if needed...');
  for (const file of ['README.md', 'LICENSE']) {
    const { stdout: fileOut } = await execFile('git', ['show', `${lastTag}:${file}`]);
    fs.writeFileSync(file, fileOut, 'utf8');
  }
  console.log('  done');

  console.log('Commit changes to gh-pages branch...');
  await execFile('git', ['add', 'i-slide*.js']);
  await execFile('git', ['add', 'README.md']);
  await execFile('git', ['add', 'LICENSE']);
  const { stdout: diffOut } = await execFile('git', ['diff', '--staged', '--compact-summary']);
  if (diffOut.trim()) {
    console.log(diffOut);
    await execFile('git', ['commit', '-m', `Update published libs for ${lastTag}`]);
    console.log('  done');
  }
  else {
    console.log('  nothing to commit');
  }

  console.log('Switch back to initial branch...');
  await execFile('git', ['checkout', branchName]);
  console.log('  done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
