import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import { sveltePreprocess } from 'svelte-preprocess';
import terser from '@rollup/plugin-terser';

export default {
	input: 'src/index.js',
	output: {
		format: 'iife',
		name: 'StoplightAnalyzer',
		file: 'build/stoplight-analyzer.min.js',
		sourcemap: false,
	},
	plugins: [
		svelte({
			preprocess: sveltePreprocess(),
			compilerOptions: {
				customElement: true,
			},
		}),
		resolve({ browser: true, dedupe: ['svelte'] }),
		terser()
	],
}
