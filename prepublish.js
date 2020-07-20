if (!process.env.RELEASE_MODE) {
	console.log('Run `npm run release` to publish the package');
	process.exit(1);
}

const { writeFileSync, readFileSync, copyFileSync, unlinkSync, existsSync } = require('fs');

const packageJson = JSON.parse(readFileSync('package.json').toString());

delete packageJson.scripts;

writeFileSync('dist/package.json', JSON.stringify(packageJson, null, 2));

const copyingFiles = ['LICENSE', 'README.md'];

for (const cf of copyingFiles) {
	copyFileSync(cf, `dist/${cf}`);
}

if (existsSync('dist/tsconfig.build.tsbuildinfo')) {
	unlinkSync('dist/tsconfig.build.tsbuildinfo');
}
