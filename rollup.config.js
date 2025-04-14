import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import { sveltePreprocess } from 'svelte-preprocess';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
	input: 'src/index.js',
	output: {
		format: 'iife',
		name: 'StoplightAnalyzer',
		file: 'build/embed.js',
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
		commonjs(),
		json()
	],
}
