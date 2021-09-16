/**
 * Create one JS library per tag and commit the result to the gh-pages branch
 * 
 * node tools/publish-tags.js
 */

const util = require('util');
const fs = require('fs');
const execFile = util.promisify(require('child_process').execFile);

async function main() {
  console.log('Retrieve list of tags...');
  const { stdout: tagOut } = await execFile('git', ['tag', '--sort=-v:refname']);
  const tags = tagOut.split(/[\r\n]/).filter(tag => !!tag);
  const lastTag = tags[0] ?? 'last commit';
  console.log(`  ${tags.length} tags found`);

  console.log('Lookup name of current branch...');
  const { stdout: branchOut } = await execFile('git', ['branch', '--show-current']);
  const branchName = branchOut.trim();
  console.log(`  on branch ${branchName}`);

  console.log('Switch to gh-pages branch...');
  const { stdout: checkOut } = await execFile('git', ['checkout', 'gh-pages']);
  console.log('  done');

  console.log('Create one lib file per tag...');
  for (const tag of tags) {
    const { stdout: showOut } = await execFile('git', ['show', `${tag}:i-slide.js`]);
    fs.writeFileSync(`i-slide-${tag}.js`, showOut, 'utf8');
  }
  console.log('  done');

  console.log('Add nightly version from main branch...')
  const { stdout: mainOut } = await execFile('git', ['show', 'main:i-slide.js']);
  fs.writeFileSync('i-slide.js', mainOut, 'utf8');
  console.log('  done');

  console.log('Commit changes to gh-pages branch...');
  await execFile('git', ['add', 'i-slide*.js']);
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
