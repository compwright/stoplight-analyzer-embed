import svelteRetag from 'svelte-retag';
import Embed from './Embed.svelte';

svelteRetag({
	component: Embed,
	tagname: 'stoplight-analyzer-widget',
	shadow: false // Use the light DOM
});
