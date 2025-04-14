import svelteRetag from 'svelte-retag';
import StoplightAnalyzer from './StoplightAnalyzer.svelte';

svelteRetag({
	component: StoplightAnalyzer,
	tagname: 'stoplight-analyzer',
	shadow: false // Use the light DOM
});
