(function (sveltestrap) {
	'use strict';

	/**
	 * Functions are placed here for better encapsulation and readability of the main codebase. This helps to isolate them
	 * from the DOM API of the implemented web component (particularly if they are static and do not need access to instance
	 * level information, i.e. they do not call "this").
	 */


	/**
	 * Extracted from svelte's internal API @ src/runtime/internal/dom.js
	 *
	 * @param {Node} target
	 * @param {Node} node
	 * @param {Node} [anchor]
	 * @returns {void}
	 */
	function insert(target, node, anchor) {
		target.insertBefore(node, anchor || null);
	}


	/**
	 * Extracted from svelte's internal API @ src/runtime/internal/dom.js
	 *
	 * @param {Node} node
	 * @returns {void}
	 */
	function detach(node) {
		if (node.parentNode) {
			node.parentNode.removeChild(node);
		}
	}


	/**
	 * Creates an object where each property represents the slot name and each value represents a Svelte-specific slot
	 * object containing the lifecycle hooks for each slot. This wraps our slot elements and is passed to Svelte itself.
	 *
	 * Much of this witchcraft is from svelte issue - https://github.com/sveltejs/svelte/issues/2588
	 */
	function createSvelteSlots(slots) {
		const svelteSlots = {};
		for(const slotName in slots) {
			svelteSlots[slotName] = [createSlotFn(slots[slotName])];
		}

		function createSlotFn(element) {
			return function() {
				return {
					c: function() {}, // noop
					m: function mount(target, anchor) {
						insert(target, element.cloneNode(true), anchor);
					},
					d: function destroy(detaching) {
						if (detaching) {
							detach(element);
						}
					},
					l: function() {}, // noop
				};
			};
		}

		return svelteSlots;
	}


	/**
	 * Traverses DOM to find the first custom element that the provided <slot> element happens to belong to.
	 *
	 * @param {Element} slot
	 * @returns {HTMLElement|null}
	 */
	function findSlotParent(slot) {
		let parentEl = slot.parentElement;
		while(parentEl) {
			if (parentEl.tagName.indexOf('-') !== -1) return parentEl;
			parentEl = parentEl.parentElement;
		}
		return null;
	}


	/**
	 * Carefully "unwraps" the custom element tag itself from its default slot content (particularly if that content
	 * is just a text node). Only used when not using shadow root.
	 *
	 * @param {HTMLElement} from
	 *
	 * @returns {DocumentFragment}
	 */
	function unwrap(from) {
		let node = document.createDocumentFragment();
		while(from.firstChild) {
			node.appendChild(from.firstChild);
		}
		return node;
	}

	/**
	 * Tracks the mapping of case-insensitive attributes to case-sensitive component props on a per-tag basis. Setup as a
	 * global cache so we can avoid setting up a Proxy on every single component render but also to assist in mapping during
	 * hits to attributeChangedCallback().
	 */
	const propMapCache = new Map();


	/**
	 * Mutation observer must be used to track changes to attributes on our custom elements, since we cannot know the
	 * component props ahead of time (required if we were to use observedAttributes instead). In this case, only one
	 * observer is necessary, since each call to .observe() can have a different "attributeFilter" specified.
	 * NOTE: We can .observe() many separate elements and don't have to .disconnect() each one individually, since if the
	 * element being observed is removed from the DOM and released by the garbage collector, the MutationObserver will
	 * stop observing the removed element automatically.
	 */
	const attributeObserver = new MutationObserver((mutations) => {
		// Go through each mutation and forward the updated attribute value to the corresponding Svelte prop.
		mutations.forEach(mutation => {
			const element = mutation.target;
			const attributeName = mutation.attributeName;
			const newValue = element.getAttribute(attributeName);
			element.forwardAttributeToProp(attributeName, newValue);
		});
	});


	/**
	 * Processes the queued set of svelte-retag managed elements which have been initialized, connected and flagged as ready
	 * for render. This is done just before paint with the goal of processing as many as possible at once not only for speed
	 * but also to ensure we can render properly from the top down (parent to child). This is necessary, as the actual
	 * construct() and connectedCallback()'s for custom elements depends largely on *when* the elements are defined and
	 * encountered in the DOM (can be in any order). This allows us to better control that process.
	 *
	 * @param {number} timestamp
	 */
	// eslint-disable-next-line no-unused-vars
	function renderElements(timestamp) {
		// This is key: Fetches elements in document order so we can render top-down (for context).
		let renderQueue = document.querySelectorAll('[data-svelte-retag-render]');
		if (renderQueue.length === 0) {
			// TODO: Consider build of svelte-retag so we can drop console.logs() when publishing without having to comment out. See: https://github.com/vitejs/vite/discussions/7920
			//console.debug(`renderElements(${timestamp}): returned, queue is now empty`);
			return;
		}

		for(let element of renderQueue) {
			// Element was queued but likely rearranged due to the parent rendering first (resulting in a new instance and this
			// being forever orphaned).
			if (!element.isConnected) {
				//console.debug(`renderElements(${timestamp}): skipped, already disconnected:`, element);
				continue;
			}

			// Quick double check: Skip any which have *light* DOM parents that are queued for render. See _queueForRender() for details.
			if (element.parentElement.closest('[data-svelte-retag-render="light"]') === null) {
				element.removeAttribute('data-svelte-retag-render');
				element._renderSvelteComponent();
			}
		}
	}


	/**
	 * @typedef {new(...args: any[]) => any} Newable        Type alias for a really generic class constructor
	 * @typedef {Newable}                    CmpConstructor Svelte component class constructor (basically a "newable" object)
	 */

	/**
	 * @typedef {object} SvelteRetagOptions Configuration options for svelte-retag. See README.md for details.
	 *
	 * @property {CmpConstructor}   component       The Svelte component *class* constructor to incorporate into your custom element (this is the imported component class, *not* an instance)
	 * @property {string}           tagname         Name of the custom element tag you'd like to define.
	 * @property {string[]|boolean} [attributes=[]] Optional array of attributes that should be reactively forwarded to the component when modified. Set to true to automatically watch all attributes.
	 * @property {boolean|string[]} [ignoreCommonAttribWarnings=false]  Suppresses warnings in development mode about common attributes (such as "id", "class" and "data-*") if they don't already exist on the component. Set to an array to customize the list of ignored attributes.
	 * @property {boolean}          [shadow=false]  Indicates if we should build the component in the shadow root instead of in the regular ("light") DOM.
	 * @property {string}           [href=""]       URL to the CSS stylesheet to incorporate into the shadow DOM (if enabled).
	 *
	 * Experimental:
	 * @property {boolean}          [hydratable=false] EXPERIMENTAL. Light DOM slot hydration (specific to svelte-retag): Enables
	 * 	                                               pre-rendering of the web component (e.g. SSR) by adding extra markers
	 * 	                                               (attributes & wrappers) during rendering to enable svelte-retag to find and
	 * 	                                               restore light DOM slots when restoring interactivity. See README.md for more.
	 * @property {boolean|'cli'}   [debugMode=false]  Hidden option to enable debugging for package development purposes.
	 *
	 */

	/**
	 * Please see README.md for usage information.
	 *
	 * @param {SvelteRetagOptions} opts Configuration options for svelte-retag. See README.md for details.
	 */
	function svelteRetag(opts) {
		/**
		 * Reserves our special <svelte-retag> custom element container which is used to wrap Svelte components.
		 *
		 * When performing light DOM rendering, this provides the opportunity to isolate the slot content away from the HTML
		 * rendered by the component itself. This is particularly necessary if we're executing early (e.g. via IIFE formatted
		 * bundles and not via native ESM modules, which are deferred) since we need to rerender the component as the parser
		 * progresses along the current element's slot content. This ultimately reduces (if not eliminates) the typical
		 * cumulative layout shift (CLS) seen when injecting components into the DOM like this (especially noticeable on
		 * initial page loads). That CLS typically occurs because ESM modules are deferred (as noted above) but also because
		 * it's difficult to know what the correct/final slot content will be until after the parser has rendered the DOM for
		 * us.
		 *
		 * When performing shadow DOM rendering, it provides an un-styled container where we can attach the Svelte component
		 * once it begins rendering.
		 */
		if (!window.customElements.get('svelte-retag')) {
			window.customElements.define('svelte-retag', class extends HTMLElement {
				// noop
			});

			// When the 'hydratable' option is enabled, this special wrapper will be applied around default slot content so
			// that it can be discovered and restored later after pre-rendering. NOTE: This tag is always available since
			// we can always hydrate. It is only applied to rendered content if elected for a particular component.
			window.customElements.define('svelte-retag-default', class extends HTMLElement {
				// noop
			});
		}

		// Filter for dynamically ignoring errors when using common attributes which might potentially be on a custom element
		// but ALSO aren't already explicitly defined on the Svelte component. Default to false but allow user to enable.
		let ignoreAttribFilter = () => false;
		if (opts?.ignoreCommonAttribWarnings === true) {
			ignoreAttribFilter = (name) => {
				return (name === 'id' || name === 'class' || name === 'style' || name.startsWith('data-'));
			};
		} else if (Array.isArray(opts.ignoreCommonAttribWarnings)) {
			ignoreAttribFilter = (name) => {
				return opts.ignoreCommonAttribWarnings.includes(name);
			};
		}

		/**
		 * Object containing keys pointing to slots: Either an actual <slot> element or a document fragment created to wrap
		 * default slot content.
		 *
		 * @typedef {Object.<string, HTMLSlotElement|DocumentFragment>} SlotList
		 */

		/**
		 * Defines the actual custom element responsible for rendering the provided Svelte component.
		 */
		window.customElements.define(opts.tagname, class extends HTMLElement {
			constructor() {
				super();

				this._debug('constructor()');

				// New instances, attributes not yet being observed.
				this.attributesObserved = false;


				// Setup shadow root early (light-DOM root is initialized in connectedCallback() below).
				if (opts.shadow) {
					this.attachShadow({ mode: 'open' });
					// TODO: Better than <div>, but: Is a wrapper entirely necessary? Why not just set this._root = this.shadowRoot?
					this._root = document.createElement('svelte-retag');
					this.shadowRoot.appendChild(this._root);

					// Link generated style. Do early as possible to ensure we start downloading CSS (reduces FOUC).
					if (opts.href) {
						let link = document.createElement('link');
						link.setAttribute('href', opts.href);
						link.setAttribute('rel', 'stylesheet');
						this.shadowRoot.appendChild(link);
					}
				}
			}

			/**
			 * Attributes we're watching for changes after render (doesn't affect attributes already present prior to render).
			 *
			 * NOTE: This only applies if opts.attributes is an array. If opts.attributes is true, then all attributes are
			 * watched using the mutation observer instead.
			 *
			 * @returns string[]
			 */
			static get observedAttributes() {
				if (Array.isArray(opts.attributes)) {
					// User defined an explicit list or nothing at all.
					return opts.attributes;
				} else {
					return [];
				}
			}

			/**
			 * Attached to DOM.
			 */
			connectedCallback() {
				this._debug('connectedCallback()');

				/**
				 * TODO: Light DOM: Potential optimization opportunities:
				 *  1. Don't bother setting up <svelte-retag> wrapper if the component doesn't have a default slot and isn't hydratable
				 *  2. Don't setup <svelte-retag> wrapper if we don't end up processing mutations (i.e. document not in loading state).
				 *  If this happens though, we must only setup/destroy in connected/disconnected callbacks and thus anything that
				 *  depends upon it needs a separate method of determining. Maybe getter that checks if this._root.tagName === 'SVELTE-RETAG'?
				 */

				// Initialize the slot elements object which retains a reference to the original elements (by slot name) so they
				// can be restored later on disconnectedCallback(). Also useful for debugging purposes.
				this.slotEls = {};

				// If compiled as IIFE/UMD and executed early, then the document is likely to be in the process of loading
				// and thus actively parsing tags, including not only this tag but also nested content (which may not yet be
				// available).
				const isLoading = (document.readyState === 'loading');

				// Setup the special <svelte-retag> wrapper if not already present (which can happen when
				// disconnected/reconnected due to being in a slot).
				if (!opts.shadow) {
					// See if this component is pre-rendered and flagged as able to hydrate slots from the light DOM root.
					if (this.hasAttribute('data-svelte-retag-hydratable')) {
						if (isLoading) {
							// Wait for the slots to become fully available.
							// NOTE: We expect <svelte-retag> wrapper to already be present, however it may not be
							// accessible until after the browser has finished parsing the DOM.
							this._onSlotsReady(() => {
								this._initLightRoot();
								this._hydrateLightSlots();
								this._queueForRender();
							});
							return;

						} else {
							// Light DOM slots are already all available, so hydrate them now and allow Svelte component
							// rendering to proceed normally below.
							this._initLightRoot();
							this._hydrateLightSlots();
						}
					} else {
						// Setup the wrapper now since we don't have to worry about hydration.
						this._initLightRoot();
					}
				}

				// Watch for changes to slot elements and ensure they're reflected in the Svelte component.
				if (opts.shadow) {
					this._observeSlots(true);
				} else {
					if (isLoading) {
						// Setup the mutation observer to watch content as parser progresses through the HTML and adds nodes under
						// this element. However, since this is only useful in light DOM elements *during* parsing, we should be sure
						// to stop observing once the HTML is fully parsed and loaded.
						this._observeSlots(true);
						this._onSlotsReady(() => {
							this._observeSlots(false);
						});
					}
				}

				// Now that we're connected to the DOM, we can render the component now.
				this._queueForRender();

				// If we want to enable the current component as hydratable, add the flag now that it has been fully
				// rendered (now that slots have been located under the Svelte component). This attribute is important since
				// it allows us to know immediately that this component is capable of being hydrated (useful if compiled and
				// executed as IIFE/UMD).
				if (opts.hydratable) {
					this.setAttribute('data-svelte-retag-hydratable', '');
				}
			}

			/**
			 * Removed from DOM (could be called inside another custom element that starts rendering after this one). In that
			 * situation, the connectedCallback() will be executed again (most likely with constructor() as well, unfortunately).
			 */
			disconnectedCallback() {
				this._debug('disconnectedCallback()');

				// Remove render flag (if present). This could happen in case the element is disconnected while waiting to render
				// (particularly if slotted under a light DOM parent).
				this.removeAttribute('data-svelte-retag-render');

				// Remove hydration flag, if present. This component will be able to be rendered from scratch instead.
				this.removeAttribute('data-svelte-retag-hydratable');

				// Disconnect slot mutation observer (if it's currently active).
				this._observeSlots(false);

				// Double check that element has been initialized already. This could happen in case connectedCallback() hasn't
				// fully completed yet (e.g. if initialization is async)
				if (this.componentInstance) {
					try {
						// Clean up: Destroy Svelte component when removed from DOM.
						this.componentInstance.$destroy();
						delete this.componentInstance;
					} catch(err) {
						console.error(`Error destroying Svelte component in '${this.tagName}'s disconnectedCallback(): ${err}`);
					}
				}

				if (!opts.shadow) {
					// Restore slots back to the light DOM in case we're just being appended elsewhere (likely if we're nested under
					// another custom element that initializes after this custom element, thus causing *another* round of
					// construct/connectedCallback on this one).
					this._restoreLightSlots();

					// Lastly, unwinding everything in reverse: Remove the "light" DOM root (the special <svelte-tag> wrapper) which
					// is only added during connectedCallback(), unlike shadow DOM which is attached in construct.
					this.removeChild(this._root);
				}
			}

			/**
			 * Callback/hook for observedAttributes.
			 *
			 * @param {string} name
			 * @param {string} oldValue
			 * @param {string} newValue
			 */
			attributeChangedCallback(name, oldValue, newValue) {
				this._debug('attributes changed', { name, oldValue, newValue });
				this.forwardAttributeToProp(name, newValue);
			}

			/**
			 * Forward modifications to element attributes to the corresponding Svelte prop (if applicable).
			 *
			 * @param {string} name
			 * @param {string} value
			 */
			forwardAttributeToProp(name, value) {
				this._debug('forwardAttributeToProp', { name, value });

				// If instance already available, pass it through immediately.
				if (this.componentInstance) {
					let translatedName = this._translateAttribute(name);
					if (translatedName !== null) {
						this.componentInstance.$set({ [translatedName]: value });
					}
				}
			}

			/**
			 * Setup a wrapper in the light DOM which can keep the rendered Svelte component separate from the default Slot
			 * content, which is potentially being actively appended (at least while the browser parses during loading).
			 */
			_initLightRoot() {
				// Recycle the existing light DOM root, if already present.
				let existingRoot = this.querySelector('svelte-retag');
				if (existingRoot !== null && existingRoot.parentElement === this) {
					this._debug('_initLightRoot(): Restore from existing light DOM root');
					this._root = existingRoot;
				} else {
					// Setup new (first time).
					this._root = document.createElement('svelte-retag');
					this.prepend(this._root);
				}
			}

			/**
			 * Queues the provided callback to execute when we think all slots are fully loaded and available to fetch and
			 * manipulate.
			 *
			 * @param {callback} callback
			 */
			_onSlotsReady(callback) {
				document.addEventListener('readystatechange', () => {
					if (document.readyState === 'interactive') {
						callback();
					}
				});
			}

			/**
			 * Converts the provided lowercase attribute name to the correct case-sensitive component prop name, if possible.
			 *
			 * @param {string} attributeName
			 * @returns {string|null}
			 */
			_translateAttribute(attributeName) {
				// In the unlikely scenario that a browser somewhere doesn't do this for us (or maybe we're in a quirks mode or something...)
				attributeName = attributeName.toLowerCase();
				if (this.propMap && this.propMap.has(attributeName)) {
					return this.propMap.get(attributeName);
				} else {
					// Return it unchanged but only if it's not in our "ignore attributes" filter.
					if (!ignoreAttribFilter(attributeName)) {
						this._debug(`_translateAttribute(): ${attributeName} not found on component, keeping unchanged`);
						return attributeName;
					} else {
						// Ignored.
						this._debug(`_translateAttribute(): ${attributeName} matched ignore filter, skipping entirely`);
						return null;
					}
				}
			}

			/**
			 * To support context, this traverses the DOM to find potential parent elements (also managed by svelte-retag) which
			 * may contain context necessary to render this component.
			 *
			 * See context functions at: https://svelte.dev/docs/svelte#setcontext
			 *
			 * @returns {Map|null}
			 */
			_getAncestorContext() {
				let node = this;
				while(node.parentNode) {
					node = node.parentNode;
					let context = node?.componentInstance?.$$?.context;
					if (context instanceof Map) {
						return context;
					}
				}

				return null;
			}

			/**
			 * Queue this element for render in the next animation frame. This offers the opportunity to render known available
			 * elements all at once and, ideally, from the top down (to preserve context).
			 */
			_queueForRender() {
				// No point if already disconnected. Attempting to hit the parent element will trigger an error.
				if (!this.isConnected) {
					this._debug('queueForRender(): skipped, already disconnected');
					return;
				}

				// Skip the queue if a parent is already queued for render, but for the light DOM only. This is because if it's in the
				// light DOM slot, it will be disconnected and reconnected again (which will then also trigger a need to render).
				if (this.parentElement.closest('[data-svelte-retag-render="light"]') !== null) {
					this._debug('queueForRender(): skipped, light DOM parent is queued for render');
					return;
				}

				// When queuing for render, it's also necessary to identify the DOM rendering type. This is necessary for child
				// components which are *underneath* a parent that is using light DOM rendering (see above). This helps to ensure
				// rendering is performed in the correct order (useful for things like context).
				this.setAttribute('data-svelte-retag-render', opts.shadow ? 'shadow' : 'light');
				requestAnimationFrame(renderElements);
			}

			/**
			 * Renders (or rerenders) the Svelte component into this custom element based on the latest properties and slots
			 * (with slots initialized elsewhere).
			 *
			 * IMPORTANT:
			 *
			 * Despite the intuitive name, this method is private since its functionality requires a deeper understanding
			 * of how it depends on current internal state and how it alters internal state. Be sure to study how it's called
			 * before calling it yourself externally. ("Yarrr! Here be dragons! 🔥🐉")
			 *
			 * That said... this is currently the workflow:
			 *
			 * 1. Wait for connection to DOM
			 * 2. Ensure slots are properly prepared (e.g. in case of hydration) or observed (in case actively parsing DOM, e.g.
			 *    IIFE/UMD or shadow DOM) in case there are any changes *after* this render
			 * 3. _queueForRender(): Kick off to requestAnimationFrame() to queue render of the component (instead of rendering
			 *    immediately) to ensure that all currently connected and available components are taken into account (this is
			 *    necessary for properly supporting context to prevent from initializing components out of order).
			 * 4. renderElements(): Renders through the DOM tree in document order and from the top down (parent to child),
			 *    reaching this element instantiating this component, ensuring context is preserved.
			 *
			 */
			_renderSvelteComponent() {
				this._debug('renderSvelteComponent()');

				// Fetch the latest set of available slot elements to use in the render. For light DOM, this must be done prior
				// to clearing inner HTML below since the slots exist there.
				if (opts.shadow) {
					this.slotEls = this._getShadowSlots();
				} else {
					this.slotEls = this._getLightSlots();
				}

				// On each rerender, we have to reset our root container since Svelte will just append to our target.
				this._root.innerHTML = '';

				// Prep context, which is an important dependency prior to ANY instantiation of the Svelte component.
				const context = this._getAncestorContext() || new Map();

				// Props always passed to Svelte component constructor.
				let props = {
					$$scope: {},

					// Convert our list of slots into Svelte-specific slot objects
					$$slots: createSvelteSlots(this.slotEls),

					// All other *initial* props are pulled dynamically from element attributes (see proxy below)...
				};

				// Conveying props while translating them FROM a case-insensitive form like attributes (which are forced
				// case-insensitive) TO a case-sensitive form (which is required by the component) can be very tricky. This is
				// because we really cannot know the correct case until AFTER the component is instantiated. Therefore, a proxy is
				// a great way to infer the correct case, since by design, all components attempt to access ALL their props when
				// instantiated. Once accessed the first time for a particular tag, we no longer need to proxy since we know for
				// certain that the same tag will be used for any particular component (whose props will not change).
				if (!propMapCache.has(this.tagName)) {
					// Initialize mapping of props for this tag for use later. This way, we can avoid proxying on every single
					// component render/instantiation but also for attributeChangedCallback().
					this.propMap = new Map();
					propMapCache.set(this.tagName, this.propMap);

					props = new Proxy(props, {
						get: (target, prop) => {
							// Warm cache with prop translations from forced lowercase to their real case.
							let propName = prop.toString();
							if (prop.indexOf('$$') === -1) {
								this.propMap.set(propName.toLowerCase(), propName);
							}

							// While here, see if this attempted access matches an element attribute. Note, this lookup is
							// already case-insensitive, see: https://dom.spec.whatwg.org/#namednodemap
							let attribValue = this.attributes.getNamedItem(propName);
							if (attribValue !== null) {
								// Before returning, ensure the prop is at least initialized on the target. This ensures that Vite HMR
								// will be aware that the prop exists when creating the proxied component (since it enumerates all props).
								// This prevents it from resetting back to the props default state during HMR reloads (the same as how it
								// works if the component were to have been defined inside of another Svelte component instead of as a
								// custom element here).
								return target[propName] = attribValue.value;
							} else {
								// IMPORTANT: Unlike above, we SHOULD NOT be initializing target[propName] here, even though it could offer benefits
								// (like allowing the latest *evolved* prop value to be persisted after HMR updates). The reason is that
								// Svelte itself will *also* reset the prop to its default value after HMR updates *unless* the parent Svelte
								// component explicitly sets the prop. If we set it here, we would diverge from how Svelte handles undefined
								// props during HMR reloads.

								// Fail over to what would have otherwise been returned.
								return target[prop];
							}
						},
					});

				} else {
					// Skip the proxying of props and just recycle the cached mapping to populate custom element attributes into the
					// props object with the correct case.
					this.propMap = propMapCache.get(this.tagName);
					for(let attr of [...this.attributes]) {
						// Note: Skip svelte-retag specific attributes (used for hydration purposes). This is not included in the ignored
						// attributes filter since it's a special case and cannot be overridden.
						if (attr.name.startsWith('data-svelte-retag')) continue;
						const translatedName = this._translateAttribute(attr.name);
						if (translatedName !== null) {
							props[translatedName] = attr.value;
						}
					}
				}

				// Instantiate component into our root now, which is either the "light DOM" (i.e. directly under this element) or
				// in the shadow DOM.
				this.componentInstance = new opts.component({ target: this._root, props: props, context });

				// Setup mutation observer to watch for changes to attributes on this element (if not already done) now that we
				// know the full set of component props. Only do this if configured and if the observer hasn't already been setup
				// (since we can render an element multiple times).
				if (opts.attributes === true && !this.attributesObserved) {
					this.attributesObserved = true;
					if (this.propMap.size > 0) {
						attributeObserver.observe(this, {
							attributes: true, // implicit, but... 🤷‍♂️
							attributeFilter: [...this.propMap.keys()],
						});
					} else {
						// No props to observe, so no point in setting up the observer.
						this._debug('renderSvelteComponent(): skipped attribute observer, no props');
					}
				}


				this._debug('renderSvelteComponent(): completed');
			}

			/**
			 * Fetches slots from pre-rendered Svelte component HTML using special markers (either data attributes or custom
			 * wrappers). Note that this will only work during initialization and only if the Svelte retag instance is
			 * hydratable.
			 */
			_hydrateLightSlots() {
				// Get the named slots inside the already rendered component by looking for our special data attribute.
				let existingNamedSlots = this._root.querySelectorAll('[data-svelte-retag-slot]');
				for(let slot of existingNamedSlots) {
					// Ensure we stick only to slots that belong to this element (avoid deeply nested components).
					let slotParent = findSlotParent(slot);
					if (slotParent !== this._root) continue;

					let slotName = slot.getAttribute('slot');
					this.slotEls[slotName] = slot;
				}

				// If default slot content was used, it should still be wrapped in a special <svelte-retag-default>,
				// which preserves all child nodes (including text nodes).
				let existingDefaultSlot = this.querySelector('svelte-retag-default');
				if (existingDefaultSlot !== null) {
					this.slotEls['default'] = existingDefaultSlot;
				}

				// Put all slots back to their original positions (including unwrapping default slot content) to
				// prepare for initial component render.
				this._restoreLightSlots();

				return true;
			}

			/**
			 * Indicates if the provided <slot> element instance belongs to this custom element or not.
			 *
			 * @param {Element} slot
			 * @returns {boolean}
			 */
			_isOwnSlot(slot) {
				let slotParent = findSlotParent(slot);
				if (slotParent === null) return false;
				return (slotParent === this);
			}

			/**
			 * Returns a map of slot names and the corresponding HTMLElement (named slots) or DocumentFragment (default slots).
			 *
			 * IMPORTANT: Since this custom element is the "root", these slots must be removed (which is done in THIS method).
			 *
			 * TODO: Problematic name. We are "getting" but we're also mangling/mutating state (which *is* necessary). "Get" may be confusing here; is there a better name?
			 *
			 * @returns {SlotList}
			 */
			_getLightSlots() {
				this._debug('_getLightSlots()');
				let slots = {};


				/***************
				 * NAMED SLOTS *
				 ***************/

				// Look for named slots below this element. IMPORTANT: This may return slots nested deeper (see check in forEach below).
				const queryNamedSlots = this.querySelectorAll('[slot]');
				for(let candidate of queryNamedSlots) {
					// Skip this slot if it doesn't happen to belong to THIS custom element.
					if (!this._isOwnSlot(candidate)) continue;

					slots[candidate.slot] = candidate;

					// If this is a hydratable component, flag this slot so we can find it later once it has been relocated
					// under the fully rendered Svelte component (in the light DOM).
					if (opts.hydratable) {
						candidate.setAttribute('data-svelte-retag-slot', '');
					}

					// TODO: Potentially problematic in edge cases where the browser may *oddly* return slots from query selector
					//  above, yet their not actually a child of the current element. This seems to only happen if another
					//  constructor() + connectedCallback() are BOTH called for this particular element again BEFORE a
					//  disconnectedCallback() gets called (out of sync). Only experienced in Chrome when manually editing the HTML
					//  when there were multiple other custom elements present inside the slot of another element (very edge case?)
					this.removeChild(candidate);
				}


				/**************************
				 * DEFAULT SLOT (UNNAMED) *
				 **************************/

				// "Unwrap" the remainder of this tag by iterating through child nodes and placing them into a fragment which
				// we can use as our default slot. Importantly, we need to ensure we skip our special <svelte-retag> wrapper.
				// Here we use a special <svelte-retag-default> custom element that allows us to target it later in case we
				// need to hydrate it (e.g. tag was rendered via SSG/SSR and disconnectedCallback() was not run).
				let fragment = document.createDocumentFragment();

				// For hydratable components, we have to nest these nodes under a tag that we can still recognize once
				// they're shifted inside of the fully rendered Svelte component, which could be anywhere.
				if (opts.hydratable) {
					fragment = document.createElement('svelte-retag-default');
				}

				// Important: The conversion of these children to an array is necessary since we are actually modifying the list by calling .appendChild().
				let childNodes = [...this.childNodes];
				let childHTML = '';
				for(let childNode of childNodes) {
					if (childNode instanceof HTMLElement && childNode.tagName === 'SVELTE-RETAG') {
						this._debug('_getLightSlots(): skipping <svelte-retag> container');
						continue;
					}

					// Unfortunately, we must manually build HTML because DocumentFragment can be problematic with this:
					// 1. Deep clone is required in order to put it into another HTMLElement, might be slow
					// 2. Deep clone doesn't work in unit tests
					if (childNode instanceof Text) {
						childHTML += childNode.textContent;
					} else if (childNode.outerHTML) {
						childHTML += childNode.outerHTML;
					}

					fragment.appendChild(childNode);
				}

				// Now that we've rebuilt the default slot content, it could actually be empty (or just whitespace). So, we
				// have to check the HTML in the fragment to see if it has anything in it before trying to use it.
				if (childHTML.trim() !== '') {
					// Now that we've detected remaining content, we've got to make suer we don't already have an explicitly
					// named "default" slot. If one does exist, then we have a conflict.
					if (slots.default) {
						// Edge case: User has a named "default" as well as remaining HTML left over. Use same error as Svelte.
						console.error(`svelteRetag: '${this.tagName}': Found elements without slot attribute when using slot="default"`);
					} else {
						slots.default = fragment;
					}
				}

				return slots;
			}

			/**
			 * Go through originally removed slots and restore back to the custom element.
			 */
			_restoreLightSlots() {
				this._debug('_restoreLightSlots:', this.slotEls);

				for(let slotName in this.slotEls) {
					let slotEl = this.slotEls[slotName];

					// Prepend back so that in case more default slot content has arrived, we can rebuild it in order. This is
					// important if we're executing during document.readyState === 'loading' (i.e. IIFE and not module).
					if (slotEl.tagName === 'SVELTE-RETAG-DEFAULT') {
						this.prepend(unwrap(slotEl));
					} else {
						this.prepend(slotEl);

						// If hydration was enabled for this particular element (not necessarily for the current context),
						// we should clean up hydration-specific attributes for consistency.
						if (slotEl instanceof HTMLElement && slotEl.hasAttribute('data-svelte-retag-slot')) {
							slotEl.removeAttribute('data-svelte-retag-slot');
						}
					}
				}

				// Since the slots are back in the original element, we should clean  up our reference to them. This is because,
				// symbolically and semantically at least, we think of this variable as a holding area ONCE they've been removed.
				this.slotEls = {};
			}

			/**
			 * Fetches and returns references to the existing shadow DOM slots. Left unmodified.
			 *
			 * @returns {SlotList}
			 */
			_getShadowSlots() {
				this._debug('_getShadowSlots()');
				const namedSlots = this.querySelectorAll('[slot]');
				let slots = {};
				let htmlLength = this.innerHTML.length;
				namedSlots.forEach(n => {
					slots[n.slot] = document.createElement('slot');
					slots[n.slot].setAttribute('name', n.slot);
					htmlLength -= n.outerHTML.length;
				});
				if (htmlLength > 0) {
					slots.default = document.createElement('slot');
				}
				return slots;
			}

			/**
			 * Toggle on/off the MutationObserver used to watch for changes in child slots.
			 */
			_observeSlots(begin) {
				// While MutationObserver de-duplicates requests for us, this helps us with reducing noise while debugging.
				if (begin === this.slotObserverActive) return;

				// Setup our slot observer if not done already.
				if (!this.slotObserver) {
					this.slotObserver = new MutationObserver((mutations) => {
						this._processSlotMutations(mutations);
					});
				}

				if (begin) {
					// Subtree: Typically, slots (both default and named) are only ever added directly below. So, keeping
					// subtree false for now since this could be important for light DOM.
					this.slotObserver.observe(this, { childList: true, subtree: false, attributes: false });
					this._debug('_observeSlots: OBSERVE');
				} else {
					this.slotObserver.disconnect();
					this._debug('_observeSlots: DISCONNECT');
				}

				this.slotObserverActive = begin;
			}

			/**
			 * Watches for slot changes, specifically:
			 *
			 * 1. Shadow DOM: All slot changes will queue a rerender of the Svelte component
			 *
			 * 2. Light DOM: Only additions will be accounted for. This is particularly because currently we only support
			 *    watching for changes during document parsing (i.e. document.readyState === 'loading', prior to the
			 *    'DOMContentLoaded' event.
			 *
			 * @param {MutationRecord[]} mutations
			 */
			_processSlotMutations(mutations) {
				this._debug('_processSlotMutations()', mutations);

				// Rerender if one of the mutations is of a child element.
				let rerender = false;
				for(let mutation of mutations) {
					if (mutation.type === 'childList') {
						// For shadow DOM, it's alright if it's a removal.
						if (opts.shadow) {
							rerender = true;
							break;
						} else {
							// For light DOM, it only matters to rerender on newly added nodes. This is because we're only watching for
							// mutations during initial document parsing. Node removals can happen during the retrieval of light slots in
							// _getLightSlots(). These are necessary, but may cascade into an infinite loop if we're not very careful here.
							if (mutation.addedNodes.length > 0) {
								rerender = true;
								break;
							}
						}
					}
				}

				if (rerender) {
					if (!opts.shadow) {
						// For light DOM, ensure original slots are available by prepending them back to the DOM so we can fetch the
						// latest content. This is important in case the newly visible nodes are part of default content (not just
						// named slots)
						this._observeSlots(false);
						this._restoreLightSlots();
						this._observeSlots(true);
					}

					// Force a rerender now.
					this._debug('_processMutations(): Queue rerender');
					this._queueForRender();
				}
			}

			/**
			 * Pass through to console.log() but includes a reference to the custom element in the log for easier targeting for
			 * debugging purposes.
			 *
			 * @param {...*}
			 */
			_debug() {
				if (opts.debugMode) {
					if (opts.debugMode === 'cli') {
						console.log.apply(null, [performance.now(), this.tagName, ...arguments]);
					} else {
						console.log.apply(null, [performance.now(), this, ...arguments]);
					}
				}
			}
		});
	}

	// generated during release, do not modify

	const PUBLIC_VERSION = '5';

	if (typeof window !== 'undefined') {
		// @ts-expect-error
		((window.__svelte ??= {}).v ??= new Set()).add(PUBLIC_VERSION);
	}

	const TEMPLATE_FRAGMENT = 1;
	const TEMPLATE_USE_IMPORT_NODE = 1 << 1;

	const HYDRATION_START = '[';
	/** used to indicate that an `{:else}...` block was rendered */
	const HYDRATION_START_ELSE = '[!';
	const HYDRATION_END = ']';
	const HYDRATION_ERROR = {};

	const UNINITIALIZED = Symbol();

	var DEV = false;

	// Store the references to globals in case someone tries to monkey patch these, causing the below
	// to de-opt (this occurs often when using popular extensions).
	var is_array = Array.isArray;
	var index_of = Array.prototype.indexOf;
	var array_from = Array.from;
	var object_keys = Object.keys;
	var define_property = Object.defineProperty;
	var get_descriptor = Object.getOwnPropertyDescriptor;
	var object_prototype = Object.prototype;
	var array_prototype = Array.prototype;
	var get_prototype_of = Object.getPrototypeOf;
	var is_extensible = Object.isExtensible;

	/** @param {Array<() => void>} arr */
	function run_all(arr) {
		for (var i = 0; i < arr.length; i++) {
			arr[i]();
		}
	}

	const DERIVED = 1 << 1;
	const EFFECT = 1 << 2;
	const RENDER_EFFECT = 1 << 3;
	const BLOCK_EFFECT = 1 << 4;
	const BRANCH_EFFECT = 1 << 5;
	const ROOT_EFFECT = 1 << 6;
	const BOUNDARY_EFFECT = 1 << 7;
	const UNOWNED = 1 << 8;
	const DISCONNECTED = 1 << 9;
	const CLEAN = 1 << 10;
	const DIRTY = 1 << 11;
	const MAYBE_DIRTY = 1 << 12;
	const INERT = 1 << 13;
	const DESTROYED = 1 << 14;
	const EFFECT_RAN = 1 << 15;
	/** 'Transparent' effects do not create a transition boundary */
	const EFFECT_TRANSPARENT = 1 << 16;
	const HEAD_EFFECT = 1 << 19;
	const EFFECT_HAS_DERIVED = 1 << 20;
	const EFFECT_IS_UPDATING = 1 << 21;

	const STATE_SYMBOL = Symbol('$state');
	const LEGACY_PROPS = Symbol('legacy props');

	/* This file is generated by scripts/process-messages/index.js. Do not edit! */


	/**
	 * Maximum update depth exceeded. This can happen when a reactive block or effect repeatedly sets a new value. Svelte limits the number of nested updates to prevent infinite loops
	 * @returns {never}
	 */
	function effect_update_depth_exceeded() {
		{
			throw new Error(`https://svelte.dev/e/effect_update_depth_exceeded`);
		}
	}

	/**
	 * Failed to hydrate the application
	 * @returns {never}
	 */
	function hydration_failed() {
		{
			throw new Error(`https://svelte.dev/e/hydration_failed`);
		}
	}

	/**
	 * Property descriptors defined on `$state` objects must contain `value` and always be `enumerable`, `configurable` and `writable`.
	 * @returns {never}
	 */
	function state_descriptors_fixed() {
		{
			throw new Error(`https://svelte.dev/e/state_descriptors_fixed`);
		}
	}

	/**
	 * Cannot set prototype of `$state` object
	 * @returns {never}
	 */
	function state_prototype_fixed() {
		{
			throw new Error(`https://svelte.dev/e/state_prototype_fixed`);
		}
	}

	/**
	 * Updating state inside a derived or a template expression is forbidden. If the value should not be reactive, declare it without `$state`
	 * @returns {never}
	 */
	function state_unsafe_mutation() {
		{
			throw new Error(`https://svelte.dev/e/state_unsafe_mutation`);
		}
	}

	/* This file is generated by scripts/process-messages/index.js. Do not edit! */


	/**
	 * Hydration failed because the initial UI does not match what was rendered on the server. The error occurred near %location%
	 * @param {string | undefined | null} [location]
	 */
	function hydration_mismatch(location) {
		{
			console.warn(`https://svelte.dev/e/hydration_mismatch`);
		}
	}

	/** @import { TemplateNode } from '#client' */


	/**
	 * Use this variable to guard everything related to hydration code so it can be treeshaken out
	 * if the user doesn't use the `hydrate` method and these code paths are therefore not needed.
	 */
	let hydrating = false;

	/** @param {boolean} value */
	function set_hydrating(value) {
		hydrating = value;
	}

	/**
	 * The node that is currently being hydrated. This starts out as the first node inside the opening
	 * <!--[--> comment, and updates each time a component calls `$.child(...)` or `$.sibling(...)`.
	 * When entering a block (e.g. `{#if ...}`), `hydrate_node` is the block opening comment; by the
	 * time we leave the block it is the closing comment, which serves as the block's anchor.
	 * @type {TemplateNode}
	 */
	let hydrate_node;

	/** @param {TemplateNode} node */
	function set_hydrate_node(node) {
		if (node === null) {
			hydration_mismatch();
			throw HYDRATION_ERROR;
		}

		return (hydrate_node = node);
	}

	function hydrate_next() {
		return set_hydrate_node(/** @type {TemplateNode} */ (get_next_sibling(hydrate_node)));
	}

	/** @param {TemplateNode} node */
	function reset(node) {
		if (!hydrating) return;

		// If the node has remaining siblings, something has gone wrong
		if (get_next_sibling(hydrate_node) !== null) {
			hydration_mismatch();
			throw HYDRATION_ERROR;
		}

		hydrate_node = node;
	}

	function next(count = 1) {
		if (hydrating) {
			var i = count;
			var node = hydrate_node;

			while (i--) {
				node = /** @type {TemplateNode} */ (get_next_sibling(node));
			}

			hydrate_node = node;
		}
	}

	/**
	 * Removes all nodes starting at `hydrate_node` up until the next hydration end comment
	 */
	function remove_nodes() {
		var depth = 0;
		var node = hydrate_node;

		while (true) {
			if (node.nodeType === 8) {
				var data = /** @type {Comment} */ (node).data;

				if (data === HYDRATION_END) {
					if (depth === 0) return node;
					depth -= 1;
				} else if (data === HYDRATION_START || data === HYDRATION_START_ELSE) {
					depth += 1;
				}
			}

			var next = /** @type {TemplateNode} */ (get_next_sibling(node));
			node.remove();
			node = next;
		}
	}

	let tracing_mode_flag = false;

	/** @import { Source } from '#client' */

	/**
	 * @template T
	 * @param {T} value
	 * @returns {T}
	 */
	function proxy(value) {
		// if non-proxyable, or is already a proxy, return `value`
		if (typeof value !== 'object' || value === null || STATE_SYMBOL in value) {
			return value;
		}

		const prototype = get_prototype_of(value);

		if (prototype !== object_prototype && prototype !== array_prototype) {
			return value;
		}

		/** @type {Map<any, Source<any>>} */
		var sources = new Map();
		var is_proxied_array = is_array(value);
		var version = state(0);
		var reaction = active_reaction;

		/**
		 * @template T
		 * @param {() => T} fn
		 */
		var with_parent = (fn) => {
			var previous_reaction = active_reaction;
			set_active_reaction(reaction);

			/** @type {T} */
			var result = fn();

			set_active_reaction(previous_reaction);
			return result;
		};

		if (is_proxied_array) {
			// We need to create the length source eagerly to ensure that
			// mutations to the array are properly synced with our proxy
			sources.set('length', state(/** @type {any[]} */ (value).length));
		}

		return new Proxy(/** @type {any} */ (value), {
			defineProperty(_, prop, descriptor) {
				if (
					!('value' in descriptor) ||
					descriptor.configurable === false ||
					descriptor.enumerable === false ||
					descriptor.writable === false
				) {
					// we disallow non-basic descriptors, because unless they are applied to the
					// target object — which we avoid, so that state can be forked — we will run
					// afoul of the various invariants
					// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/getOwnPropertyDescriptor#invariants
					state_descriptors_fixed();
				}

				var s = sources.get(prop);

				if (s === undefined) {
					s = with_parent(() => state(descriptor.value));
					sources.set(prop, s);
				} else {
					set(
						s,
						with_parent(() => proxy(descriptor.value))
					);
				}

				return true;
			},

			deleteProperty(target, prop) {
				var s = sources.get(prop);

				if (s === undefined) {
					if (prop in target) {
						sources.set(
							prop,
							with_parent(() => state(UNINITIALIZED))
						);
					}
				} else {
					// When working with arrays, we need to also ensure we update the length when removing
					// an indexed property
					if (is_proxied_array && typeof prop === 'string') {
						var ls = /** @type {Source<number>} */ (sources.get('length'));
						var n = Number(prop);

						if (Number.isInteger(n) && n < ls.v) {
							set(ls, n);
						}
					}
					set(s, UNINITIALIZED);
					update_version(version);
				}

				return true;
			},

			get(target, prop, receiver) {
				if (prop === STATE_SYMBOL) {
					return value;
				}

				var s = sources.get(prop);
				var exists = prop in target;

				// create a source, but only if it's an own property and not a prototype property
				if (s === undefined && (!exists || get_descriptor(target, prop)?.writable)) {
					s = with_parent(() => state(proxy(exists ? target[prop] : UNINITIALIZED)));
					sources.set(prop, s);
				}

				if (s !== undefined) {
					var v = get(s);
					return v === UNINITIALIZED ? undefined : v;
				}

				return Reflect.get(target, prop, receiver);
			},

			getOwnPropertyDescriptor(target, prop) {
				var descriptor = Reflect.getOwnPropertyDescriptor(target, prop);

				if (descriptor && 'value' in descriptor) {
					var s = sources.get(prop);
					if (s) descriptor.value = get(s);
				} else if (descriptor === undefined) {
					var source = sources.get(prop);
					var value = source?.v;

					if (source !== undefined && value !== UNINITIALIZED) {
						return {
							enumerable: true,
							configurable: true,
							value,
							writable: true
						};
					}
				}

				return descriptor;
			},

			has(target, prop) {
				if (prop === STATE_SYMBOL) {
					return true;
				}

				var s = sources.get(prop);
				var has = (s !== undefined && s.v !== UNINITIALIZED) || Reflect.has(target, prop);

				if (
					s !== undefined ||
					(active_effect !== null && (!has || get_descriptor(target, prop)?.writable))
				) {
					if (s === undefined) {
						s = with_parent(() => state(has ? proxy(target[prop]) : UNINITIALIZED));
						sources.set(prop, s);
					}

					var value = get(s);
					if (value === UNINITIALIZED) {
						return false;
					}
				}

				return has;
			},

			set(target, prop, value, receiver) {
				var s = sources.get(prop);
				var has = prop in target;

				// variable.length = value -> clear all signals with index >= value
				if (is_proxied_array && prop === 'length') {
					for (var i = value; i < /** @type {Source<number>} */ (s).v; i += 1) {
						var other_s = sources.get(i + '');
						if (other_s !== undefined) {
							set(other_s, UNINITIALIZED);
						} else if (i in target) {
							// If the item exists in the original, we need to create a uninitialized source,
							// else a later read of the property would result in a source being created with
							// the value of the original item at that index.
							other_s = with_parent(() => state(UNINITIALIZED));
							sources.set(i + '', other_s);
						}
					}
				}

				// If we haven't yet created a source for this property, we need to ensure
				// we do so otherwise if we read it later, then the write won't be tracked and
				// the heuristics of effects will be different vs if we had read the proxied
				// object property before writing to that property.
				if (s === undefined) {
					if (!has || get_descriptor(target, prop)?.writable) {
						s = with_parent(() => state(undefined));
						set(
							s,
							with_parent(() => proxy(value))
						);
						sources.set(prop, s);
					}
				} else {
					has = s.v !== UNINITIALIZED;
					set(
						s,
						with_parent(() => proxy(value))
					);
				}

				var descriptor = Reflect.getOwnPropertyDescriptor(target, prop);

				// Set the new value before updating any signals so that any listeners get the new value
				if (descriptor?.set) {
					descriptor.set.call(receiver, value);
				}

				if (!has) {
					// If we have mutated an array directly, we might need to
					// signal that length has also changed. Do it before updating metadata
					// to ensure that iterating over the array as a result of a metadata update
					// will not cause the length to be out of sync.
					if (is_proxied_array && typeof prop === 'string') {
						var ls = /** @type {Source<number>} */ (sources.get('length'));
						var n = Number(prop);

						if (Number.isInteger(n) && n >= ls.v) {
							set(ls, n + 1);
						}
					}

					update_version(version);
				}

				return true;
			},

			ownKeys(target) {
				get(version);

				var own_keys = Reflect.ownKeys(target).filter((key) => {
					var source = sources.get(key);
					return source === undefined || source.v !== UNINITIALIZED;
				});

				for (var [key, source] of sources) {
					if (source.v !== UNINITIALIZED && !(key in target)) {
						own_keys.push(key);
					}
				}

				return own_keys;
			},

			setPrototypeOf() {
				state_prototype_fixed();
			}
		});
	}

	/**
	 * @param {Source<number>} signal
	 * @param {1 | -1} [d]
	 */
	function update_version(signal, d = 1) {
		set(signal, signal.v + d);
	}

	/** @import { TemplateNode } from '#client' */

	// export these for reference in the compiled code, making global name deduplication unnecessary
	/** @type {Window} */
	var $window;

	/** @type {Document} */
	var $document;

	/** @type {boolean} */
	var is_firefox;

	/** @type {() => Node | null} */
	var first_child_getter;
	/** @type {() => Node | null} */
	var next_sibling_getter;

	/**
	 * Initialize these lazily to avoid issues when using the runtime in a server context
	 * where these globals are not available while avoiding a separate server entry point
	 */
	function init_operations() {
		if ($window !== undefined) {
			return;
		}

		$window = window;
		$document = document;
		is_firefox = /Firefox/.test(navigator.userAgent);

		var element_prototype = Element.prototype;
		var node_prototype = Node.prototype;
		var text_prototype = Text.prototype;

		// @ts-ignore
		first_child_getter = get_descriptor(node_prototype, 'firstChild').get;
		// @ts-ignore
		next_sibling_getter = get_descriptor(node_prototype, 'nextSibling').get;

		if (is_extensible(element_prototype)) {
			// the following assignments improve perf of lookups on DOM nodes
			// @ts-expect-error
			element_prototype.__click = undefined;
			// @ts-expect-error
			element_prototype.__className = undefined;
			// @ts-expect-error
			element_prototype.__attributes = null;
			// @ts-expect-error
			element_prototype.__style = undefined;
			// @ts-expect-error
			element_prototype.__e = undefined;
		}

		if (is_extensible(text_prototype)) {
			// @ts-expect-error
			text_prototype.__t = undefined;
		}
	}

	/**
	 * @param {string} value
	 * @returns {Text}
	 */
	function create_text(value = '') {
		return document.createTextNode(value);
	}

	/**
	 * @template {Node} N
	 * @param {N} node
	 * @returns {Node | null}
	 */
	/*@__NO_SIDE_EFFECTS__*/
	function get_first_child(node) {
		return first_child_getter.call(node);
	}

	/**
	 * @template {Node} N
	 * @param {N} node
	 * @returns {Node | null}
	 */
	/*@__NO_SIDE_EFFECTS__*/
	function get_next_sibling(node) {
		return next_sibling_getter.call(node);
	}

	/**
	 * Don't mark this as side-effect-free, hydration needs to walk all nodes
	 * @template {Node} N
	 * @param {N} node
	 * @param {boolean} is_text
	 * @returns {Node | null}
	 */
	function child(node, is_text) {
		if (!hydrating) {
			return get_first_child(node);
		}

		var child = /** @type {TemplateNode} */ (get_first_child(hydrate_node));

		// Child can be null if we have an element with a single child, like `<p>{text}</p>`, where `text` is empty
		if (child === null) {
			child = hydrate_node.appendChild(create_text());
		} else if (is_text && child.nodeType !== 3) {
			var text = create_text();
			child?.before(text);
			set_hydrate_node(text);
			return text;
		}

		set_hydrate_node(child);
		return child;
	}

	/**
	 * Don't mark this as side-effect-free, hydration needs to walk all nodes
	 * @param {DocumentFragment | TemplateNode[]} fragment
	 * @param {boolean} is_text
	 * @returns {Node | null}
	 */
	function first_child(fragment, is_text) {
		if (!hydrating) {
			// when not hydrating, `fragment` is a `DocumentFragment` (the result of calling `open_frag`)
			var first = /** @type {DocumentFragment} */ (get_first_child(/** @type {Node} */ (fragment)));

			// TODO prevent user comments with the empty string when preserveComments is true
			if (first instanceof Comment && first.data === '') return get_next_sibling(first);

			return first;
		}

		return hydrate_node;
	}

	/**
	 * Don't mark this as side-effect-free, hydration needs to walk all nodes
	 * @param {TemplateNode} node
	 * @param {number} count
	 * @param {boolean} is_text
	 * @returns {Node | null}
	 */
	function sibling(node, count = 1, is_text = false) {
		let next_sibling = hydrating ? hydrate_node : node;
		var last_sibling;

		while (count--) {
			last_sibling = next_sibling;
			next_sibling = /** @type {TemplateNode} */ (get_next_sibling(next_sibling));
		}

		if (!hydrating) {
			return next_sibling;
		}

		var type = next_sibling?.nodeType;

		// if a sibling {expression} is empty during SSR, there might be no
		// text node to hydrate — we must therefore create one
		if (is_text && type !== 3) {
			var text = create_text();
			// If the next sibling is `null` and we're handling text then it's because
			// the SSR content was empty for the text, so we need to generate a new text
			// node and insert it after the last sibling
			if (next_sibling === null) {
				last_sibling?.after(text);
			} else {
				next_sibling.before(text);
			}
			set_hydrate_node(text);
			return text;
		}

		set_hydrate_node(next_sibling);
		return /** @type {TemplateNode} */ (next_sibling);
	}

	/**
	 * @template {Node} N
	 * @param {N} node
	 * @returns {void}
	 */
	function clear_text_content(node) {
		node.textContent = '';
	}

	/** @import { Equals } from '#client' */
	/** @type {Equals} */
	function equals(value) {
		return value === this.v;
	}

	/**
	 * @param {unknown} a
	 * @param {unknown} b
	 * @returns {boolean}
	 */
	function safe_not_equal(a, b) {
		return a != a
			? b == b
			: a !== b || (a !== null && typeof a === 'object') || typeof a === 'function';
	}

	/** @type {Equals} */
	function safe_equals(value) {
		return !safe_not_equal(value, this.v);
	}

	/** @import { Derived, Effect } from '#client' */

	/**
	 * @template V
	 * @param {() => V} fn
	 * @returns {Derived<V>}
	 */
	/*#__NO_SIDE_EFFECTS__*/
	function derived(fn) {
		var flags = DERIVED | DIRTY;
		var parent_derived =
			active_reaction !== null && (active_reaction.f & DERIVED) !== 0
				? /** @type {Derived} */ (active_reaction)
				: null;

		if (active_effect === null || (parent_derived !== null && (parent_derived.f & UNOWNED) !== 0)) {
			flags |= UNOWNED;
		} else {
			// Since deriveds are evaluated lazily, any effects created inside them are
			// created too late to ensure that the parent effect is added to the tree
			active_effect.f |= EFFECT_HAS_DERIVED;
		}

		/** @type {Derived<V>} */
		const signal = {
			ctx: component_context,
			deps: null,
			effects: null,
			equals,
			f: flags,
			fn,
			reactions: null,
			rv: 0,
			v: /** @type {V} */ (null),
			wv: 0,
			parent: parent_derived ?? active_effect
		};

		return signal;
	}

	/**
	 * @template V
	 * @param {() => V} fn
	 * @returns {Derived<V>}
	 */
	/*#__NO_SIDE_EFFECTS__*/
	function user_derived(fn) {
		const d = derived(fn);

		push_reaction_value(d);

		return d;
	}

	/**
	 * @param {Derived} derived
	 * @returns {void}
	 */
	function destroy_derived_effects(derived) {
		var effects = derived.effects;

		if (effects !== null) {
			derived.effects = null;

			for (var i = 0; i < effects.length; i += 1) {
				destroy_effect(/** @type {Effect} */ (effects[i]));
			}
		}
	}

	/**
	 * @param {Derived} derived
	 * @returns {Effect | null}
	 */
	function get_derived_parent_effect(derived) {
		var parent = derived.parent;
		while (parent !== null) {
			if ((parent.f & DERIVED) === 0) {
				return /** @type {Effect} */ (parent);
			}
			parent = parent.parent;
		}
		return null;
	}

	/**
	 * @template T
	 * @param {Derived} derived
	 * @returns {T}
	 */
	function execute_derived(derived) {
		var value;
		var prev_active_effect = active_effect;

		set_active_effect(get_derived_parent_effect(derived));

		{
			try {
				destroy_derived_effects(derived);
				value = update_reaction(derived);
			} finally {
				set_active_effect(prev_active_effect);
			}
		}

		return value;
	}

	/**
	 * @param {Derived} derived
	 * @returns {void}
	 */
	function update_derived(derived) {
		var value = execute_derived(derived);
		var status =
			(skip_reaction || (derived.f & UNOWNED) !== 0) && derived.deps !== null ? MAYBE_DIRTY : CLEAN;

		set_signal_status(derived, status);

		if (!derived.equals(value)) {
			derived.v = value;
			derived.wv = increment_write_version();
		}
	}

	/** @import { ComponentContext, ComponentContextLegacy, Derived, Effect, TemplateNode, TransitionManager } from '#client' */

	/**
	 * @param {Effect} effect
	 * @param {Effect} parent_effect
	 */
	function push_effect(effect, parent_effect) {
		var parent_last = parent_effect.last;
		if (parent_last === null) {
			parent_effect.last = parent_effect.first = effect;
		} else {
			parent_last.next = effect;
			effect.prev = parent_last;
			parent_effect.last = effect;
		}
	}

	/**
	 * @param {number} type
	 * @param {null | (() => void | (() => void))} fn
	 * @param {boolean} sync
	 * @param {boolean} push
	 * @returns {Effect}
	 */
	function create_effect(type, fn, sync, push = true) {
		var parent = active_effect;

		/** @type {Effect} */
		var effect = {
			ctx: component_context,
			deps: null,
			nodes_start: null,
			nodes_end: null,
			f: type | DIRTY,
			first: null,
			fn,
			last: null,
			next: null,
			parent,
			prev: null,
			teardown: null,
			transitions: null,
			wv: 0
		};

		if (sync) {
			try {
				update_effect(effect);
				effect.f |= EFFECT_RAN;
			} catch (e) {
				destroy_effect(effect);
				throw e;
			}
		} else if (fn !== null) {
			schedule_effect(effect);
		}

		// if an effect has no dependencies, no DOM and no teardown function,
		// don't bother adding it to the effect tree
		var inert =
			sync &&
			effect.deps === null &&
			effect.first === null &&
			effect.nodes_start === null &&
			effect.teardown === null &&
			(effect.f & (EFFECT_HAS_DERIVED | BOUNDARY_EFFECT)) === 0;

		if (!inert && push) {
			if (parent !== null) {
				push_effect(effect, parent);
			}

			// if we're in a derived, add the effect there too
			if (active_reaction !== null && (active_reaction.f & DERIVED) !== 0) {
				var derived = /** @type {Derived} */ (active_reaction);
				(derived.effects ??= []).push(effect);
			}
		}

		return effect;
	}

	/**
	 * @param {() => void} fn
	 */
	function teardown(fn) {
		const effect = create_effect(RENDER_EFFECT, null, false);
		set_signal_status(effect, CLEAN);
		effect.teardown = fn;
		return effect;
	}

	/**
	 * Internal representation of `$effect.root(...)`
	 * @param {() => void | (() => void)} fn
	 * @returns {() => void}
	 */
	function effect_root(fn) {
		const effect = create_effect(ROOT_EFFECT, fn, true);

		return () => {
			destroy_effect(effect);
		};
	}

	/**
	 * An effect root whose children can transition out
	 * @param {() => void} fn
	 * @returns {(options?: { outro?: boolean }) => Promise<void>}
	 */
	function component_root(fn) {
		const effect = create_effect(ROOT_EFFECT, fn, true);

		return (options = {}) => {
			return new Promise((fulfil) => {
				if (options.outro) {
					pause_effect(effect, () => {
						destroy_effect(effect);
						fulfil(undefined);
					});
				} else {
					destroy_effect(effect);
					fulfil(undefined);
				}
			});
		};
	}

	/**
	 * @param {() => void | (() => void)} fn
	 * @returns {Effect}
	 */
	function effect(fn) {
		return create_effect(EFFECT, fn, false);
	}

	/**
	 * @param {() => void | (() => void)} fn
	 * @returns {Effect}
	 */
	function render_effect(fn) {
		return create_effect(RENDER_EFFECT, fn, true);
	}

	/**
	 * @param {(...expressions: any) => void | (() => void)} fn
	 * @param {Array<() => any>} thunks
	 * @returns {Effect}
	 */
	function template_effect(fn, thunks = [], d = derived) {
		const deriveds = thunks.map(d);
		const effect = () => fn(...deriveds.map(get));

		return block(effect);
	}

	/**
	 * @param {(() => void)} fn
	 * @param {number} flags
	 */
	function block(fn, flags = 0) {
		return create_effect(RENDER_EFFECT | BLOCK_EFFECT | flags, fn, true);
	}

	/**
	 * @param {(() => void)} fn
	 * @param {boolean} [push]
	 */
	function branch(fn, push = true) {
		return create_effect(RENDER_EFFECT | BRANCH_EFFECT, fn, true, push);
	}

	/**
	 * @param {Effect} effect
	 */
	function execute_effect_teardown(effect) {
		var teardown = effect.teardown;
		if (teardown !== null) {
			const previously_destroying_effect = is_destroying_effect;
			const previous_reaction = active_reaction;
			set_is_destroying_effect(true);
			set_active_reaction(null);
			try {
				teardown.call(null);
			} finally {
				set_is_destroying_effect(previously_destroying_effect);
				set_active_reaction(previous_reaction);
			}
		}
	}

	/**
	 * @param {Effect} signal
	 * @param {boolean} remove_dom
	 * @returns {void}
	 */
	function destroy_effect_children(signal, remove_dom = false) {
		var effect = signal.first;
		signal.first = signal.last = null;

		while (effect !== null) {
			var next = effect.next;

			if ((effect.f & ROOT_EFFECT) !== 0) {
				// this is now an independent root
				effect.parent = null;
			} else {
				destroy_effect(effect, remove_dom);
			}

			effect = next;
		}
	}

	/**
	 * @param {Effect} signal
	 * @returns {void}
	 */
	function destroy_block_effect_children(signal) {
		var effect = signal.first;

		while (effect !== null) {
			var next = effect.next;
			if ((effect.f & BRANCH_EFFECT) === 0) {
				destroy_effect(effect);
			}
			effect = next;
		}
	}

	/**
	 * @param {Effect} effect
	 * @param {boolean} [remove_dom]
	 * @returns {void}
	 */
	function destroy_effect(effect, remove_dom = true) {
		var removed = false;

		if ((remove_dom || (effect.f & HEAD_EFFECT) !== 0) && effect.nodes_start !== null) {
			/** @type {TemplateNode | null} */
			var node = effect.nodes_start;
			var end = effect.nodes_end;

			while (node !== null) {
				/** @type {TemplateNode | null} */
				var next = node === end ? null : /** @type {TemplateNode} */ (get_next_sibling(node));

				node.remove();
				node = next;
			}

			removed = true;
		}

		destroy_effect_children(effect, remove_dom && !removed);
		remove_reactions(effect, 0);
		set_signal_status(effect, DESTROYED);

		var transitions = effect.transitions;

		if (transitions !== null) {
			for (const transition of transitions) {
				transition.stop();
			}
		}

		execute_effect_teardown(effect);

		var parent = effect.parent;

		// If the parent doesn't have any children, then skip this work altogether
		if (parent !== null && parent.first !== null) {
			unlink_effect(effect);
		}

		// `first` and `child` are nulled out in destroy_effect_children
		// we don't null out `parent` so that error propagation can work correctly
		effect.next =
			effect.prev =
			effect.teardown =
			effect.ctx =
			effect.deps =
			effect.fn =
			effect.nodes_start =
			effect.nodes_end =
				null;
	}

	/**
	 * Detach an effect from the effect tree, freeing up memory and
	 * reducing the amount of work that happens on subsequent traversals
	 * @param {Effect} effect
	 */
	function unlink_effect(effect) {
		var parent = effect.parent;
		var prev = effect.prev;
		var next = effect.next;

		if (prev !== null) prev.next = next;
		if (next !== null) next.prev = prev;

		if (parent !== null) {
			if (parent.first === effect) parent.first = next;
			if (parent.last === effect) parent.last = prev;
		}
	}

	/**
	 * When a block effect is removed, we don't immediately destroy it or yank it
	 * out of the DOM, because it might have transitions. Instead, we 'pause' it.
	 * It stays around (in memory, and in the DOM) until outro transitions have
	 * completed, and if the state change is reversed then we _resume_ it.
	 * A paused effect does not update, and the DOM subtree becomes inert.
	 * @param {Effect} effect
	 * @param {() => void} [callback]
	 */
	function pause_effect(effect, callback) {
		/** @type {TransitionManager[]} */
		var transitions = [];

		pause_children(effect, transitions, true);

		run_out_transitions(transitions, () => {
			destroy_effect(effect);
			if (callback) callback();
		});
	}

	/**
	 * @param {TransitionManager[]} transitions
	 * @param {() => void} fn
	 */
	function run_out_transitions(transitions, fn) {
		var remaining = transitions.length;
		if (remaining > 0) {
			var check = () => --remaining || fn();
			for (var transition of transitions) {
				transition.out(check);
			}
		} else {
			fn();
		}
	}

	/**
	 * @param {Effect} effect
	 * @param {TransitionManager[]} transitions
	 * @param {boolean} local
	 */
	function pause_children(effect, transitions, local) {
		if ((effect.f & INERT) !== 0) return;
		effect.f ^= INERT;

		if (effect.transitions !== null) {
			for (const transition of effect.transitions) {
				if (transition.is_global || local) {
					transitions.push(transition);
				}
			}
		}

		var child = effect.first;

		while (child !== null) {
			var sibling = child.next;
			var transparent = (child.f & EFFECT_TRANSPARENT) !== 0 || (child.f & BRANCH_EFFECT) !== 0;
			// TODO we don't need to call pause_children recursively with a linked list in place
			// it's slightly more involved though as we have to account for `transparent` changing
			// through the tree.
			pause_children(child, transitions, transparent ? local : false);
			child = sibling;
		}
	}

	/**
	 * The opposite of `pause_effect`. We call this if (for example)
	 * `x` becomes falsy then truthy: `{#if x}...{/if}`
	 * @param {Effect} effect
	 */
	function resume_effect(effect) {
		resume_children(effect, true);
	}

	/**
	 * @param {Effect} effect
	 * @param {boolean} local
	 */
	function resume_children(effect, local) {
		if ((effect.f & INERT) === 0) return;
		effect.f ^= INERT;

		// Ensure the effect is marked as clean again so that any dirty child
		// effects can schedule themselves for execution
		if ((effect.f & CLEAN) === 0) {
			effect.f ^= CLEAN;
		}

		// If a dependency of this effect changed while it was paused,
		// schedule the effect to update
		if (check_dirtiness(effect)) {
			set_signal_status(effect, DIRTY);
			schedule_effect(effect);
		}

		var child = effect.first;

		while (child !== null) {
			var sibling = child.next;
			var transparent = (child.f & EFFECT_TRANSPARENT) !== 0 || (child.f & BRANCH_EFFECT) !== 0;
			// TODO we don't need to call resume_children recursively with a linked list in place
			// it's slightly more involved though as we have to account for `transparent` changing
			// through the tree.
			resume_children(child, transparent ? local : false);
			child = sibling;
		}

		if (effect.transitions !== null) {
			for (const transition of effect.transitions) {
				if (transition.is_global || local) {
					transition.in();
				}
			}
		}
	}

	/** @type {Array<() => void>} */
	let micro_tasks = [];

	/** @type {Array<() => void>} */
	let idle_tasks = [];

	function run_micro_tasks() {
		var tasks = micro_tasks;
		micro_tasks = [];
		run_all(tasks);
	}

	function run_idle_tasks() {
		var tasks = idle_tasks;
		idle_tasks = [];
		run_all(tasks);
	}

	/**
	 * @param {() => void} fn
	 */
	function queue_micro_task(fn) {
		if (micro_tasks.length === 0) {
			queueMicrotask(run_micro_tasks);
		}

		micro_tasks.push(fn);
	}

	/**
	 * Synchronously run any queued tasks.
	 */
	function flush_tasks() {
		if (micro_tasks.length > 0) {
			run_micro_tasks();
		}

		if (idle_tasks.length > 0) {
			run_idle_tasks();
		}
	}

	/** @import { ComponentContext, Derived, Effect, Reaction, Signal, Source, Value } from '#client' */
	let is_throwing_error = false;

	let is_flushing = false;

	/** @type {Effect | null} */
	let last_scheduled_effect = null;

	let is_updating_effect = false;

	let is_destroying_effect = false;

	/** @param {boolean} value */
	function set_is_destroying_effect(value) {
		is_destroying_effect = value;
	}

	// Handle effect queues

	/** @type {Effect[]} */
	let queued_root_effects = [];

	/** @type {Effect[]} Stack of effects, dev only */
	let dev_effect_stack = [];
	// Handle signal reactivity tree dependencies and reactions

	/** @type {null | Reaction} */
	let active_reaction = null;

	let untracking = false;

	/** @param {null | Reaction} reaction */
	function set_active_reaction(reaction) {
		active_reaction = reaction;
	}

	/** @type {null | Effect} */
	let active_effect = null;

	/** @param {null | Effect} effect */
	function set_active_effect(effect) {
		active_effect = effect;
	}

	/**
	 * When sources are created within a reaction, reading and writing
	 * them should not cause a re-run
	 * @type {null | Source[]}
	 */
	let reaction_sources = null;

	/** @param {Value} value */
	function push_reaction_value(value) {
		if (active_reaction !== null && active_reaction.f & EFFECT_IS_UPDATING) {
			if (reaction_sources === null) {
				reaction_sources = [value];
			} else {
				reaction_sources.push(value);
			}
		}
	}

	/**
	 * The dependencies of the reaction that is currently being executed. In many cases,
	 * the dependencies are unchanged between runs, and so this will be `null` unless
	 * and until a new dependency is accessed — we track this via `skipped_deps`
	 * @type {null | Value[]}
	 */
	let new_deps = null;

	let skipped_deps = 0;

	/**
	 * Tracks writes that the effect it's executed in doesn't listen to yet,
	 * so that the dependency can be added to the effect later on if it then reads it
	 * @type {null | Source[]}
	 */
	let untracked_writes = null;

	/** @param {null | Source[]} value */
	function set_untracked_writes(value) {
		untracked_writes = value;
	}

	/**
	 * @type {number} Used by sources and deriveds for handling updates.
	 * Version starts from 1 so that unowned deriveds differentiate between a created effect and a run one for tracing
	 **/
	let write_version = 1;

	/** @type {number} Used to version each read of a source of derived to avoid duplicating depedencies inside a reaction */
	let read_version = 0;

	// If we are working with a get() chain that has no active container,
	// to prevent memory leaks, we skip adding the reaction.
	let skip_reaction = false;

	function increment_write_version() {
		return ++write_version;
	}

	/**
	 * Determines whether a derived or effect is dirty.
	 * If it is MAYBE_DIRTY, will set the status to CLEAN
	 * @param {Reaction} reaction
	 * @returns {boolean}
	 */
	function check_dirtiness(reaction) {
		var flags = reaction.f;

		if ((flags & DIRTY) !== 0) {
			return true;
		}

		if ((flags & MAYBE_DIRTY) !== 0) {
			var dependencies = reaction.deps;
			var is_unowned = (flags & UNOWNED) !== 0;

			if (dependencies !== null) {
				var i;
				var dependency;
				var is_disconnected = (flags & DISCONNECTED) !== 0;
				var is_unowned_connected = is_unowned && active_effect !== null && !skip_reaction;
				var length = dependencies.length;

				// If we are working with a disconnected or an unowned signal that is now connected (due to an active effect)
				// then we need to re-connect the reaction to the dependency
				if (is_disconnected || is_unowned_connected) {
					var derived = /** @type {Derived} */ (reaction);
					var parent = derived.parent;

					for (i = 0; i < length; i++) {
						dependency = dependencies[i];

						// We always re-add all reactions (even duplicates) if the derived was
						// previously disconnected, however we don't if it was unowned as we
						// de-duplicate dependencies in that case
						if (is_disconnected || !dependency?.reactions?.includes(derived)) {
							(dependency.reactions ??= []).push(derived);
						}
					}

					if (is_disconnected) {
						derived.f ^= DISCONNECTED;
					}
					// If the unowned derived is now fully connected to the graph again (it's unowned and reconnected, has a parent
					// and the parent is not unowned), then we can mark it as connected again, removing the need for the unowned
					// flag
					if (is_unowned_connected && parent !== null && (parent.f & UNOWNED) === 0) {
						derived.f ^= UNOWNED;
					}
				}

				for (i = 0; i < length; i++) {
					dependency = dependencies[i];

					if (check_dirtiness(/** @type {Derived} */ (dependency))) {
						update_derived(/** @type {Derived} */ (dependency));
					}

					if (dependency.wv > reaction.wv) {
						return true;
					}
				}
			}

			// Unowned signals should never be marked as clean unless they
			// are used within an active_effect without skip_reaction
			if (!is_unowned || (active_effect !== null && !skip_reaction)) {
				set_signal_status(reaction, CLEAN);
			}
		}

		return false;
	}

	/**
	 * @param {unknown} error
	 * @param {Effect} effect
	 */
	function propagate_error(error, effect) {
		/** @type {Effect | null} */
		var current = effect;

		while (current !== null) {
			if ((current.f & BOUNDARY_EFFECT) !== 0) {
				try {
					// @ts-expect-error
					current.fn(error);
					return;
				} catch {
					// Remove boundary flag from effect
					current.f ^= BOUNDARY_EFFECT;
				}
			}

			current = current.parent;
		}

		is_throwing_error = false;
		throw error;
	}

	/**
	 * @param {Effect} effect
	 */
	function should_rethrow_error(effect) {
		return (
			(effect.f & DESTROYED) === 0 &&
			(effect.parent === null || (effect.parent.f & BOUNDARY_EFFECT) === 0)
		);
	}

	/**
	 * @param {unknown} error
	 * @param {Effect} effect
	 * @param {Effect | null} previous_effect
	 * @param {ComponentContext | null} component_context
	 */
	function handle_error(error, effect, previous_effect, component_context) {
		if (is_throwing_error) {
			if (previous_effect === null) {
				is_throwing_error = false;
			}

			if (should_rethrow_error(effect)) {
				throw error;
			}

			return;
		}

		if (previous_effect !== null) {
			is_throwing_error = true;
		}

		{
			propagate_error(error, effect);
			return;
		}
	}

	/**
	 * @param {Value} signal
	 * @param {Effect} effect
	 * @param {boolean} [root]
	 */
	function schedule_possible_effect_self_invalidation(signal, effect, root = true) {
		var reactions = signal.reactions;
		if (reactions === null) return;

		for (var i = 0; i < reactions.length; i++) {
			var reaction = reactions[i];

			if (reaction_sources?.includes(signal)) continue;

			if ((reaction.f & DERIVED) !== 0) {
				schedule_possible_effect_self_invalidation(/** @type {Derived} */ (reaction), effect, false);
			} else if (effect === reaction) {
				if (root) {
					set_signal_status(reaction, DIRTY);
				} else if ((reaction.f & CLEAN) !== 0) {
					set_signal_status(reaction, MAYBE_DIRTY);
				}
				schedule_effect(/** @type {Effect} */ (reaction));
			}
		}
	}

	/**
	 * @template V
	 * @param {Reaction} reaction
	 * @returns {V}
	 */
	function update_reaction(reaction) {
		var previous_deps = new_deps;
		var previous_skipped_deps = skipped_deps;
		var previous_untracked_writes = untracked_writes;
		var previous_reaction = active_reaction;
		var previous_skip_reaction = skip_reaction;
		var previous_reaction_sources = reaction_sources;
		var previous_component_context = component_context;
		var previous_untracking = untracking;

		var flags = reaction.f;

		new_deps = /** @type {null | Value[]} */ (null);
		skipped_deps = 0;
		untracked_writes = null;
		skip_reaction =
			(flags & UNOWNED) !== 0 && (untracking || !is_updating_effect || active_reaction === null);
		active_reaction = (flags & (BRANCH_EFFECT | ROOT_EFFECT)) === 0 ? reaction : null;

		reaction_sources = null;
		set_component_context(reaction.ctx);
		untracking = false;
		read_version++;

		reaction.f |= EFFECT_IS_UPDATING;

		try {
			var result = /** @type {Function} */ (0, reaction.fn)();
			var deps = reaction.deps;

			if (new_deps !== null) {
				var i;

				remove_reactions(reaction, skipped_deps);

				if (deps !== null && skipped_deps > 0) {
					deps.length = skipped_deps + new_deps.length;
					for (i = 0; i < new_deps.length; i++) {
						deps[skipped_deps + i] = new_deps[i];
					}
				} else {
					reaction.deps = deps = new_deps;
				}

				if (!skip_reaction) {
					for (i = skipped_deps; i < deps.length; i++) {
						(deps[i].reactions ??= []).push(reaction);
					}
				}
			} else if (deps !== null && skipped_deps < deps.length) {
				remove_reactions(reaction, skipped_deps);
				deps.length = skipped_deps;
			}

			// If we're inside an effect and we have untracked writes, then we need to
			// ensure that if any of those untracked writes result in re-invalidation
			// of the current effect, then that happens accordingly
			if (
				is_runes() &&
				untracked_writes !== null &&
				!untracking &&
				deps !== null &&
				(reaction.f & (DERIVED | MAYBE_DIRTY | DIRTY)) === 0
			) {
				for (i = 0; i < /** @type {Source[]} */ (untracked_writes).length; i++) {
					schedule_possible_effect_self_invalidation(
						untracked_writes[i],
						/** @type {Effect} */ (reaction)
					);
				}
			}

			// If we are returning to an previous reaction then
			// we need to increment the read version to ensure that
			// any dependencies in this reaction aren't marked with
			// the same version
			if (previous_reaction !== reaction) {
				read_version++;

				if (untracked_writes !== null) {
					if (previous_untracked_writes === null) {
						previous_untracked_writes = untracked_writes;
					} else {
						previous_untracked_writes.push(.../** @type {Source[]} */ (untracked_writes));
					}
				}
			}

			return result;
		} finally {
			new_deps = previous_deps;
			skipped_deps = previous_skipped_deps;
			untracked_writes = previous_untracked_writes;
			active_reaction = previous_reaction;
			skip_reaction = previous_skip_reaction;
			reaction_sources = previous_reaction_sources;
			set_component_context(previous_component_context);
			untracking = previous_untracking;

			reaction.f ^= EFFECT_IS_UPDATING;
		}
	}

	/**
	 * @template V
	 * @param {Reaction} signal
	 * @param {Value<V>} dependency
	 * @returns {void}
	 */
	function remove_reaction(signal, dependency) {
		let reactions = dependency.reactions;
		if (reactions !== null) {
			var index = index_of.call(reactions, signal);
			if (index !== -1) {
				var new_length = reactions.length - 1;
				if (new_length === 0) {
					reactions = dependency.reactions = null;
				} else {
					// Swap with last element and then remove.
					reactions[index] = reactions[new_length];
					reactions.pop();
				}
			}
		}
		// If the derived has no reactions, then we can disconnect it from the graph,
		// allowing it to either reconnect in the future, or be GC'd by the VM.
		if (
			reactions === null &&
			(dependency.f & DERIVED) !== 0 &&
			// Destroying a child effect while updating a parent effect can cause a dependency to appear
			// to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
			// allows us to skip the expensive work of disconnecting and immediately reconnecting it
			(new_deps === null || !new_deps.includes(dependency))
		) {
			set_signal_status(dependency, MAYBE_DIRTY);
			// If we are working with a derived that is owned by an effect, then mark it as being
			// disconnected.
			if ((dependency.f & (UNOWNED | DISCONNECTED)) === 0) {
				dependency.f ^= DISCONNECTED;
			}
			// Disconnect any reactions owned by this reaction
			destroy_derived_effects(/** @type {Derived} **/ (dependency));
			remove_reactions(/** @type {Derived} **/ (dependency), 0);
		}
	}

	/**
	 * @param {Reaction} signal
	 * @param {number} start_index
	 * @returns {void}
	 */
	function remove_reactions(signal, start_index) {
		var dependencies = signal.deps;
		if (dependencies === null) return;

		for (var i = start_index; i < dependencies.length; i++) {
			remove_reaction(signal, dependencies[i]);
		}
	}

	/**
	 * @param {Effect} effect
	 * @returns {void}
	 */
	function update_effect(effect) {
		var flags = effect.f;

		if ((flags & DESTROYED) !== 0) {
			return;
		}

		set_signal_status(effect, CLEAN);

		var previous_effect = active_effect;
		var previous_component_context = component_context;
		var was_updating_effect = is_updating_effect;

		active_effect = effect;
		is_updating_effect = true;

		try {
			if ((flags & BLOCK_EFFECT) !== 0) {
				destroy_block_effect_children(effect);
			} else {
				destroy_effect_children(effect);
			}

			execute_effect_teardown(effect);
			var teardown = update_reaction(effect);
			effect.teardown = typeof teardown === 'function' ? teardown : null;
			effect.wv = write_version;

			var deps = effect.deps;

			// In DEV, we need to handle a case where $inspect.trace() might
			// incorrectly state a source dependency has not changed when it has.
			// That's beacuse that source was changed by the same effect, causing
			// the versions to match. We can avoid this by incrementing the version
			var dep; if (DEV && tracing_mode_flag && (effect.f & DIRTY) !== 0 && deps !== null) ;

			if (DEV) ;
		} catch (error) {
			handle_error(error, effect, previous_effect, previous_component_context || effect.ctx);
		} finally {
			is_updating_effect = was_updating_effect;
			active_effect = previous_effect;
		}
	}

	function infinite_loop_guard() {
		try {
			effect_update_depth_exceeded();
		} catch (error) {
			// Try and handle the error so it can be caught at a boundary, that's
			// if there's an effect available from when it was last scheduled
			if (last_scheduled_effect !== null) {
				{
					handle_error(error, last_scheduled_effect, null);
				}
			} else {
				throw error;
			}
		}
	}

	function flush_queued_root_effects() {
		var was_updating_effect = is_updating_effect;

		try {
			var flush_count = 0;
			is_updating_effect = true;

			while (queued_root_effects.length > 0) {
				if (flush_count++ > 1000) {
					infinite_loop_guard();
				}

				var root_effects = queued_root_effects;
				var length = root_effects.length;

				queued_root_effects = [];

				for (var i = 0; i < length; i++) {
					var collected_effects = process_effects(root_effects[i]);
					flush_queued_effects(collected_effects);
				}
				old_values.clear();
			}
		} finally {
			is_flushing = false;
			is_updating_effect = was_updating_effect;

			last_scheduled_effect = null;
		}
	}

	/**
	 * @param {Array<Effect>} effects
	 * @returns {void}
	 */
	function flush_queued_effects(effects) {
		var length = effects.length;
		if (length === 0) return;

		for (var i = 0; i < length; i++) {
			var effect = effects[i];

			if ((effect.f & (DESTROYED | INERT)) === 0) {
				try {
					if (check_dirtiness(effect)) {
						update_effect(effect);

						// Effects with no dependencies or teardown do not get added to the effect tree.
						// Deferred effects (e.g. `$effect(...)`) _are_ added to the tree because we
						// don't know if we need to keep them until they are executed. Doing the check
						// here (rather than in `update_effect`) allows us to skip the work for
						// immediate effects.
						if (effect.deps === null && effect.first === null && effect.nodes_start === null) {
							if (effect.teardown === null) {
								// remove this effect from the graph
								unlink_effect(effect);
							} else {
								// keep the effect in the graph, but free up some memory
								effect.fn = null;
							}
						}
					}
				} catch (error) {
					handle_error(error, effect, null, effect.ctx);
				}
			}
		}
	}

	/**
	 * @param {Effect} signal
	 * @returns {void}
	 */
	function schedule_effect(signal) {
		if (!is_flushing) {
			is_flushing = true;
			queueMicrotask(flush_queued_root_effects);
		}

		var effect = (last_scheduled_effect = signal);

		while (effect.parent !== null) {
			effect = effect.parent;
			var flags = effect.f;

			if ((flags & (ROOT_EFFECT | BRANCH_EFFECT)) !== 0) {
				if ((flags & CLEAN) === 0) return;
				effect.f ^= CLEAN;
			}
		}

		queued_root_effects.push(effect);
	}

	/**
	 *
	 * This function both runs render effects and collects user effects in topological order
	 * from the starting effect passed in. Effects will be collected when they match the filtered
	 * bitwise flag passed in only. The collected effects array will be populated with all the user
	 * effects to be flushed.
	 *
	 * @param {Effect} root
	 * @returns {Effect[]}
	 */
	function process_effects(root) {
		/** @type {Effect[]} */
		var effects = [];

		/** @type {Effect | null} */
		var effect = root;

		while (effect !== null) {
			var flags = effect.f;
			var is_branch = (flags & (BRANCH_EFFECT | ROOT_EFFECT)) !== 0;
			var is_skippable_branch = is_branch && (flags & CLEAN) !== 0;

			if (!is_skippable_branch && (flags & INERT) === 0) {
				if ((flags & EFFECT) !== 0) {
					effects.push(effect);
				} else if (is_branch) {
					effect.f ^= CLEAN;
				} else {
					// Ensure we set the effect to be the active reaction
					// to ensure that unowned deriveds are correctly tracked
					// because we're flushing the current effect
					var previous_active_reaction = active_reaction;
					try {
						active_reaction = effect;
						if (check_dirtiness(effect)) {
							update_effect(effect);
						}
					} catch (error) {
						handle_error(error, effect, null, effect.ctx);
					} finally {
						active_reaction = previous_active_reaction;
					}
				}

				/** @type {Effect | null} */
				var child = effect.first;

				if (child !== null) {
					effect = child;
					continue;
				}
			}

			var parent = effect.parent;
			effect = effect.next;

			while (effect === null && parent !== null) {
				effect = parent.next;
				parent = parent.parent;
			}
		}

		return effects;
	}

	/**
	 * Synchronously flush any pending updates.
	 * Returns void if no callback is provided, otherwise returns the result of calling the callback.
	 * @template [T=void]
	 * @param {(() => T) | undefined} [fn]
	 * @returns {T}
	 */
	function flushSync(fn) {
		var result;

		flush_tasks();

		while (queued_root_effects.length > 0) {
			is_flushing = true;
			flush_queued_root_effects();
			flush_tasks();
		}

		return /** @type {T} */ (result);
	}

	/**
	 * @template V
	 * @param {Value<V>} signal
	 * @returns {V}
	 */
	function get(signal) {
		var flags = signal.f;
		var is_derived = (flags & DERIVED) !== 0;

		// Register the dependency on the current reaction signal.
		if (active_reaction !== null && !untracking) {
			if (!reaction_sources?.includes(signal)) {
				var deps = active_reaction.deps;
				if (signal.rv < read_version) {
					signal.rv = read_version;
					// If the signal is accessing the same dependencies in the same
					// order as it did last time, increment `skipped_deps`
					// rather than updating `new_deps`, which creates GC cost
					if (new_deps === null && deps !== null && deps[skipped_deps] === signal) {
						skipped_deps++;
					} else if (new_deps === null) {
						new_deps = [signal];
					} else if (!skip_reaction || !new_deps.includes(signal)) {
						// Normally we can push duplicated dependencies to `new_deps`, but if we're inside
						// an unowned derived because skip_reaction is true, then we need to ensure that
						// we don't have duplicates
						new_deps.push(signal);
					}
				}
			}
		} else if (
			is_derived &&
			/** @type {Derived} */ (signal).deps === null &&
			/** @type {Derived} */ (signal).effects === null
		) {
			var derived = /** @type {Derived} */ (signal);
			var parent = derived.parent;

			if (parent !== null && (parent.f & UNOWNED) === 0) {
				// If the derived is owned by another derived then mark it as unowned
				// as the derived value might have been referenced in a different context
				// since and thus its parent might not be its true owner anymore
				derived.f ^= UNOWNED;
			}
		}

		if (is_derived) {
			derived = /** @type {Derived} */ (signal);

			if (check_dirtiness(derived)) {
				update_derived(derived);
			}
		}

		if (is_destroying_effect && old_values.has(signal)) {
			return old_values.get(signal);
		}

		return signal.v;
	}

	const STATUS_MASK = -7169;

	/**
	 * @param {Signal} signal
	 * @param {number} status
	 * @returns {void}
	 */
	function set_signal_status(signal, status) {
		signal.f = (signal.f & STATUS_MASK) | status;
	}

	/** @import { Derived, Effect, Source, Value } from '#client' */
	const old_values = new Map();

	/**
	 * @template V
	 * @param {V} v
	 * @param {Error | null} [stack]
	 * @returns {Source<V>}
	 */
	// TODO rename this to `state` throughout the codebase
	function source(v, stack) {
		/** @type {Value} */
		var signal = {
			f: 0, // TODO ideally we could skip this altogether, but it causes type errors
			v,
			reactions: null,
			equals,
			rv: 0,
			wv: 0
		};

		return signal;
	}

	/**
	 * @template V
	 * @param {V} v
	 * @param {Error | null} [stack]
	 */
	/*#__NO_SIDE_EFFECTS__*/
	function state(v, stack) {
		const s = source(v);

		push_reaction_value(s);

		return s;
	}

	/**
	 * @template V
	 * @param {V} initial_value
	 * @param {boolean} [immutable]
	 * @returns {Source<V>}
	 */
	/*#__NO_SIDE_EFFECTS__*/
	function mutable_source(initial_value, immutable = false) {
		const s = source(initial_value);
		if (!immutable) {
			s.equals = safe_equals;
		}

		return s;
	}

	/**
	 * @template V
	 * @param {Source<V>} source
	 * @param {V} value
	 * @param {boolean} [should_proxy]
	 * @returns {V}
	 */
	function set(source, value, should_proxy = false) {
		if (
			active_reaction !== null &&
			!untracking &&
			is_runes() &&
			(active_reaction.f & (DERIVED | BLOCK_EFFECT)) !== 0 &&
			!reaction_sources?.includes(source)
		) {
			state_unsafe_mutation();
		}

		let new_value = should_proxy ? proxy(value) : value;

		return internal_set(source, new_value);
	}

	/**
	 * @template V
	 * @param {Source<V>} source
	 * @param {V} value
	 * @returns {V}
	 */
	function internal_set(source, value) {
		if (!source.equals(value)) {
			var old_value = source.v;

			if (is_destroying_effect) {
				old_values.set(source, value);
			} else {
				old_values.set(source, old_value);
			}

			source.v = value;

			if ((source.f & DERIVED) !== 0) {
				// if we are assigning to a dirty derived we set it to clean/maybe dirty but we also eagerly execute it to track the dependencies
				if ((source.f & DIRTY) !== 0) {
					execute_derived(/** @type {Derived} */ (source));
				}
				set_signal_status(source, (source.f & UNOWNED) === 0 ? CLEAN : MAYBE_DIRTY);
			}

			source.wv = increment_write_version();

			mark_reactions(source, DIRTY);

			// It's possible that the current reaction might not have up-to-date dependencies
			// whilst it's actively running. So in the case of ensuring it registers the reaction
			// properly for itself, we need to ensure the current effect actually gets
			// scheduled. i.e: `$effect(() => x++)`
			if (
				active_effect !== null &&
				(active_effect.f & CLEAN) !== 0 &&
				(active_effect.f & (BRANCH_EFFECT | ROOT_EFFECT)) === 0
			) {
				if (untracked_writes === null) {
					set_untracked_writes([source]);
				} else {
					untracked_writes.push(source);
				}
			}
		}

		return value;
	}

	/**
	 * @param {Value} signal
	 * @param {number} status should be DIRTY or MAYBE_DIRTY
	 * @returns {void}
	 */
	function mark_reactions(signal, status) {
		var reactions = signal.reactions;
		if (reactions === null) return;
		var length = reactions.length;

		for (var i = 0; i < length; i++) {
			var reaction = reactions[i];
			var flags = reaction.f;

			// Skip any effects that are already dirty
			if ((flags & DIRTY) !== 0) continue;

			set_signal_status(reaction, status);

			// If the signal a) was previously clean or b) is an unowned derived, then mark it
			if ((flags & (CLEAN | UNOWNED)) !== 0) {
				if ((flags & DERIVED) !== 0) {
					mark_reactions(/** @type {Derived} */ (reaction), MAYBE_DIRTY);
				} else {
					schedule_effect(/** @type {Effect} */ (reaction));
				}
			}
		}
	}

	/** @import { ComponentContext } from '#client' */


	/** @type {ComponentContext | null} */
	let component_context = null;

	/** @param {ComponentContext | null} context */
	function set_component_context(context) {
		component_context = context;
	}

	/**
	 * @param {Record<string, unknown>} props
	 * @param {any} runes
	 * @param {Function} [fn]
	 * @returns {void}
	 */
	function push(props, runes = false, fn) {
		var ctx = (component_context = {
			p: component_context,
			c: null,
			d: false,
			e: null,
			m: false,
			s: props,
			x: null,
			l: null
		});

		teardown(() => {
			/** @type {ComponentContext} */ (ctx).d = true;
		});
	}

	/**
	 * @template {Record<string, any>} T
	 * @param {T} [component]
	 * @returns {T}
	 */
	function pop(component) {
		const context_stack_item = component_context;
		if (context_stack_item !== null) {
			const component_effects = context_stack_item.e;
			if (component_effects !== null) {
				var previous_effect = active_effect;
				var previous_reaction = active_reaction;
				context_stack_item.e = null;
				try {
					for (var i = 0; i < component_effects.length; i++) {
						var component_effect = component_effects[i];
						set_active_effect(component_effect.effect);
						set_active_reaction(component_effect.reaction);
						effect(component_effect.fn);
					}
				} finally {
					set_active_effect(previous_effect);
					set_active_reaction(previous_reaction);
				}
			}
			component_context = context_stack_item.p;
			context_stack_item.m = true;
		}
		// Micro-optimization: Don't set .a above to the empty object
		// so it can be garbage-collected when the return here is unused
		return /** @type {T} */ ({});
	}

	/** @returns {boolean} */
	function is_runes() {
		return true;
	}

	/**
	 * Subset of delegated events which should be passive by default.
	 * These two are already passive via browser defaults on window, document and body.
	 * But since
	 * - we're delegating them
	 * - they happen often
	 * - they apply to mobile which is generally less performant
	 * we're marking them as passive by default for other elements, too.
	 */
	const PASSIVE_EVENTS = ['touchstart', 'touchmove'];

	/**
	 * Returns `true` if `name` is a passive event
	 * @param {string} name
	 */
	function is_passive_event(name) {
		return PASSIVE_EVENTS.includes(name);
	}

	/** @import { Location } from 'locate-character' */

	/** @type {Set<string>} */
	const all_registered_events = new Set();

	/** @type {Set<(events: Array<string>) => void>} */
	const root_event_handles = new Set();

	/**
	 * @this {EventTarget}
	 * @param {Event} event
	 * @returns {void}
	 */
	function handle_event_propagation(event) {
		var handler_element = this;
		var owner_document = /** @type {Node} */ (handler_element).ownerDocument;
		var event_name = event.type;
		var path = event.composedPath?.() || [];
		var current_target = /** @type {null | Element} */ (path[0] || event.target);

		// composedPath contains list of nodes the event has propagated through.
		// We check __root to skip all nodes below it in case this is a
		// parent of the __root node, which indicates that there's nested
		// mounted apps. In this case we don't want to trigger events multiple times.
		var path_idx = 0;

		// @ts-expect-error is added below
		var handled_at = event.__root;

		if (handled_at) {
			var at_idx = path.indexOf(handled_at);
			if (
				at_idx !== -1 &&
				(handler_element === document || handler_element === /** @type {any} */ (window))
			) {
				// This is the fallback document listener or a window listener, but the event was already handled
				// -> ignore, but set handle_at to document/window so that we're resetting the event
				// chain in case someone manually dispatches the same event object again.
				// @ts-expect-error
				event.__root = handler_element;
				return;
			}

			// We're deliberately not skipping if the index is higher, because
			// someone could create an event programmatically and emit it multiple times,
			// in which case we want to handle the whole propagation chain properly each time.
			// (this will only be a false negative if the event is dispatched multiple times and
			// the fallback document listener isn't reached in between, but that's super rare)
			var handler_idx = path.indexOf(handler_element);
			if (handler_idx === -1) {
				// handle_idx can theoretically be -1 (happened in some JSDOM testing scenarios with an event listener on the window object)
				// so guard against that, too, and assume that everything was handled at this point.
				return;
			}

			if (at_idx <= handler_idx) {
				path_idx = at_idx;
			}
		}

		current_target = /** @type {Element} */ (path[path_idx] || event.target);
		// there can only be one delegated event per element, and we either already handled the current target,
		// or this is the very first target in the chain which has a non-delegated listener, in which case it's safe
		// to handle a possible delegated event on it later (through the root delegation listener for example).
		if (current_target === handler_element) return;

		// Proxy currentTarget to correct target
		define_property(event, 'currentTarget', {
			configurable: true,
			get() {
				return current_target || owner_document;
			}
		});

		// This started because of Chromium issue https://chromestatus.com/feature/5128696823545856,
		// where removal or moving of of the DOM can cause sync `blur` events to fire, which can cause logic
		// to run inside the current `active_reaction`, which isn't what we want at all. However, on reflection,
		// it's probably best that all event handled by Svelte have this behaviour, as we don't really want
		// an event handler to run in the context of another reaction or effect.
		var previous_reaction = active_reaction;
		var previous_effect = active_effect;
		set_active_reaction(null);
		set_active_effect(null);

		try {
			/**
			 * @type {unknown}
			 */
			var throw_error;
			/**
			 * @type {unknown[]}
			 */
			var other_errors = [];

			while (current_target !== null) {
				/** @type {null | Element} */
				var parent_element =
					current_target.assignedSlot ||
					current_target.parentNode ||
					/** @type {any} */ (current_target).host ||
					null;

				try {
					// @ts-expect-error
					var delegated = current_target['__' + event_name];

					if (
						delegated != null &&
						(!(/** @type {any} */ (current_target).disabled) ||
							// DOM could've been updated already by the time this is reached, so we check this as well
							// -> the target could not have been disabled because it emits the event in the first place
							event.target === current_target)
					) {
						if (is_array(delegated)) {
							var [fn, ...data] = delegated;
							fn.apply(current_target, [event, ...data]);
						} else {
							delegated.call(current_target, event);
						}
					}
				} catch (error) {
					if (throw_error) {
						other_errors.push(error);
					} else {
						throw_error = error;
					}
				}
				if (event.cancelBubble || parent_element === handler_element || parent_element === null) {
					break;
				}
				current_target = parent_element;
			}

			if (throw_error) {
				for (let error of other_errors) {
					// Throw the rest of the errors, one-by-one on a microtask
					queueMicrotask(() => {
						throw error;
					});
				}
				throw throw_error;
			}
		} finally {
			// @ts-expect-error is used above
			event.__root = handler_element;
			// @ts-ignore remove proxy on currentTarget
			delete event.currentTarget;
			set_active_reaction(previous_reaction);
			set_active_effect(previous_effect);
		}
	}

	/** @import { TemplateNode } from '#client' */

	/**
	 * @type {Node | undefined}
	 */
	let head_anchor;

	function reset_head_anchor() {
		head_anchor = undefined;
	}

	/**
	 * @param {(anchor: Node) => void} render_fn
	 * @returns {void}
	 */
	function head(render_fn) {
		// The head function may be called after the first hydration pass and ssr comment nodes may still be present,
		// therefore we need to skip that when we detect that we're not in hydration mode.
		let previous_hydrate_node = null;
		let was_hydrating = hydrating;

		/** @type {Comment | Text} */
		var anchor;

		if (hydrating) {
			previous_hydrate_node = hydrate_node;

			// There might be multiple head blocks in our app, so we need to account for each one needing independent hydration.
			if (head_anchor === undefined) {
				head_anchor = /** @type {TemplateNode} */ (get_first_child(document.head));
			}

			while (
				head_anchor !== null &&
				(head_anchor.nodeType !== 8 || /** @type {Comment} */ (head_anchor).data !== HYDRATION_START)
			) {
				head_anchor = /** @type {TemplateNode} */ (get_next_sibling(head_anchor));
			}

			// If we can't find an opening hydration marker, skip hydration (this can happen
			// if a framework rendered body but not head content)
			if (head_anchor === null) {
				set_hydrating(false);
			} else {
				head_anchor = set_hydrate_node(/** @type {TemplateNode} */ (get_next_sibling(head_anchor)));
			}
		}

		if (!hydrating) {
			anchor = document.head.appendChild(create_text());
		}

		try {
			block(() => render_fn(anchor), HEAD_EFFECT);
		} finally {
			if (was_hydrating) {
				set_hydrating(true);
				head_anchor = hydrate_node; // so that next head block starts from the correct node
				set_hydrate_node(/** @type {TemplateNode} */ (previous_hydrate_node));
			}
		}
	}

	/** @param {string} html */
	function create_fragment_from_html(html) {
		var elem = document.createElement('template');
		elem.innerHTML = html;
		return elem.content;
	}

	/** @import { Effect, TemplateNode } from '#client' */

	/**
	 * @param {TemplateNode} start
	 * @param {TemplateNode | null} end
	 */
	function assign_nodes(start, end) {
		var effect = /** @type {Effect} */ (active_effect);
		if (effect.nodes_start === null) {
			effect.nodes_start = start;
			effect.nodes_end = end;
		}
	}

	/**
	 * @param {string} content
	 * @param {number} flags
	 * @returns {() => Node | Node[]}
	 */
	/*#__NO_SIDE_EFFECTS__*/
	function template(content, flags) {
		var is_fragment = (flags & TEMPLATE_FRAGMENT) !== 0;
		var use_import_node = (flags & TEMPLATE_USE_IMPORT_NODE) !== 0;

		/** @type {Node} */
		var node;

		/**
		 * Whether or not the first item is a text/element node. If not, we need to
		 * create an additional comment node to act as `effect.nodes.start`
		 */
		var has_start = !content.startsWith('<!>');

		return () => {
			if (hydrating) {
				assign_nodes(hydrate_node, null);
				return hydrate_node;
			}

			if (node === undefined) {
				node = create_fragment_from_html(has_start ? content : '<!>' + content);
				if (!is_fragment) node = /** @type {Node} */ (get_first_child(node));
			}

			var clone = /** @type {TemplateNode} */ (
				use_import_node || is_firefox ? document.importNode(node, true) : node.cloneNode(true)
			);

			if (is_fragment) {
				var start = /** @type {TemplateNode} */ (get_first_child(clone));
				var end = /** @type {TemplateNode} */ (clone.lastChild);

				assign_nodes(start, end);
			} else {
				assign_nodes(clone, clone);
			}

			return clone;
		};
	}

	/**
	 * Don't mark this as side-effect-free, hydration needs to walk all nodes
	 * @param {any} value
	 */
	function text(value = '') {
		if (!hydrating) {
			var t = create_text(value + '');
			assign_nodes(t, t);
			return t;
		}

		var node = hydrate_node;

		if (node.nodeType !== 3) {
			// if an {expression} is empty during SSR, we need to insert an empty text node
			node.before((node = create_text()));
			set_hydrate_node(node);
		}

		assign_nodes(node, node);
		return node;
	}

	function comment() {
		// we're not delegating to `template` here for performance reasons
		if (hydrating) {
			assign_nodes(hydrate_node, null);
			return hydrate_node;
		}

		var frag = document.createDocumentFragment();
		var start = document.createComment('');
		var anchor = create_text();
		frag.append(start, anchor);

		assign_nodes(start, anchor);

		return frag;
	}

	/**
	 * Assign the created (or in hydration mode, traversed) dom elements to the current block
	 * and insert the elements into the dom (in client mode).
	 * @param {Text | Comment | Element} anchor
	 * @param {DocumentFragment | Element} dom
	 */
	function append(anchor, dom) {
		if (hydrating) {
			/** @type {Effect} */ (active_effect).nodes_end = hydrate_node;
			hydrate_next();
			return;
		}

		if (anchor === null) {
			// edge case — void `<svelte:element>` with content
			return;
		}

		anchor.before(/** @type {Node} */ (dom));
	}

	/** @import { ComponentContext, Effect, TemplateNode } from '#client' */
	/** @import { Component, ComponentType, SvelteComponent, MountOptions } from '../../index.js' */

	/**
	 * @param {Element} text
	 * @param {string} value
	 * @returns {void}
	 */
	function set_text(text, value) {
		// For objects, we apply string coercion (which might make things like $state array references in the template reactive) before diffing
		var str = value == null ? '' : typeof value === 'object' ? value + '' : value;
		// @ts-expect-error
		if (str !== (text.__t ??= text.nodeValue)) {
			// @ts-expect-error
			text.__t = str;
			text.nodeValue = str + '';
		}
	}

	/**
	 * Mounts a component to the given target and returns the exports and potentially the props (if compiled with `accessors: true`) of the component.
	 * Transitions will play during the initial render unless the `intro` option is set to `false`.
	 *
	 * @template {Record<string, any>} Props
	 * @template {Record<string, any>} Exports
	 * @param {ComponentType<SvelteComponent<Props>> | Component<Props, Exports, any>} component
	 * @param {MountOptions<Props>} options
	 * @returns {Exports}
	 */
	function mount(component, options) {
		return _mount(component, options);
	}

	/**
	 * Hydrates a component on the given target and returns the exports and potentially the props (if compiled with `accessors: true`) of the component
	 *
	 * @template {Record<string, any>} Props
	 * @template {Record<string, any>} Exports
	 * @param {ComponentType<SvelteComponent<Props>> | Component<Props, Exports, any>} component
	 * @param {{} extends Props ? {
	 * 		target: Document | Element | ShadowRoot;
	 * 		props?: Props;
	 * 		events?: Record<string, (e: any) => any>;
	 *  	context?: Map<any, any>;
	 * 		intro?: boolean;
	 * 		recover?: boolean;
	 * 	} : {
	 * 		target: Document | Element | ShadowRoot;
	 * 		props: Props;
	 * 		events?: Record<string, (e: any) => any>;
	 *  	context?: Map<any, any>;
	 * 		intro?: boolean;
	 * 		recover?: boolean;
	 * 	}} options
	 * @returns {Exports}
	 */
	function hydrate(component, options) {
		init_operations();
		options.intro = options.intro ?? false;
		const target = options.target;
		const was_hydrating = hydrating;
		const previous_hydrate_node = hydrate_node;

		try {
			var anchor = /** @type {TemplateNode} */ (get_first_child(target));
			while (
				anchor &&
				(anchor.nodeType !== 8 || /** @type {Comment} */ (anchor).data !== HYDRATION_START)
			) {
				anchor = /** @type {TemplateNode} */ (get_next_sibling(anchor));
			}

			if (!anchor) {
				throw HYDRATION_ERROR;
			}

			set_hydrating(true);
			set_hydrate_node(/** @type {Comment} */ (anchor));
			hydrate_next();

			const instance = _mount(component, { ...options, anchor });

			if (
				hydrate_node === null ||
				hydrate_node.nodeType !== 8 ||
				/** @type {Comment} */ (hydrate_node).data !== HYDRATION_END
			) {
				hydration_mismatch();
				throw HYDRATION_ERROR;
			}

			set_hydrating(false);

			return /**  @type {Exports} */ (instance);
		} catch (error) {
			if (error === HYDRATION_ERROR) {
				if (options.recover === false) {
					hydration_failed();
				}

				// If an error occured above, the operations might not yet have been initialised.
				init_operations();
				clear_text_content(target);

				set_hydrating(false);
				return mount(component, options);
			}

			throw error;
		} finally {
			set_hydrating(was_hydrating);
			set_hydrate_node(previous_hydrate_node);
			reset_head_anchor();
		}
	}

	/** @type {Map<string, number>} */
	const document_listeners = new Map();

	/**
	 * @template {Record<string, any>} Exports
	 * @param {ComponentType<SvelteComponent<any>> | Component<any>} Component
	 * @param {MountOptions} options
	 * @returns {Exports}
	 */
	function _mount(Component, { target, anchor, props = {}, events, context, intro = true }) {
		init_operations();

		var registered_events = new Set();

		/** @param {Array<string>} events */
		var event_handle = (events) => {
			for (var i = 0; i < events.length; i++) {
				var event_name = events[i];

				if (registered_events.has(event_name)) continue;
				registered_events.add(event_name);

				var passive = is_passive_event(event_name);

				// Add the event listener to both the container and the document.
				// The container listener ensures we catch events from within in case
				// the outer content stops propagation of the event.
				target.addEventListener(event_name, handle_event_propagation, { passive });

				var n = document_listeners.get(event_name);

				if (n === undefined) {
					// The document listener ensures we catch events that originate from elements that were
					// manually moved outside of the container (e.g. via manual portals).
					document.addEventListener(event_name, handle_event_propagation, { passive });
					document_listeners.set(event_name, 1);
				} else {
					document_listeners.set(event_name, n + 1);
				}
			}
		};

		event_handle(array_from(all_registered_events));
		root_event_handles.add(event_handle);

		/** @type {Exports} */
		// @ts-expect-error will be defined because the render effect runs synchronously
		var component = undefined;

		var unmount = component_root(() => {
			var anchor_node = anchor ?? target.appendChild(create_text());

			branch(() => {
				if (context) {
					push({});
					var ctx = /** @type {ComponentContext} */ (component_context);
					ctx.c = context;
				}

				if (events) {
					// We can't spread the object or else we'd lose the state proxy stuff, if it is one
					/** @type {any} */ (props).$$events = events;
				}

				if (hydrating) {
					assign_nodes(/** @type {TemplateNode} */ (anchor_node), null);
				}
				// @ts-expect-error the public typings are not what the actual function looks like
				component = Component(anchor_node, props) || {};

				if (hydrating) {
					/** @type {Effect} */ (active_effect).nodes_end = hydrate_node;
				}

				if (context) {
					pop();
				}
			});

			return () => {
				for (var event_name of registered_events) {
					target.removeEventListener(event_name, handle_event_propagation);

					var n = /** @type {number} */ (document_listeners.get(event_name));

					if (--n === 0) {
						document.removeEventListener(event_name, handle_event_propagation);
						document_listeners.delete(event_name);
					} else {
						document_listeners.set(event_name, n);
					}
				}

				root_event_handles.delete(event_handle);

				if (anchor_node !== anchor) {
					anchor_node.parentNode?.removeChild(anchor_node);
				}
			};
		});

		mounted_components.set(component, unmount);
		return component;
	}

	/**
	 * References of the components that were mounted or hydrated.
	 * Uses a `WeakMap` to avoid memory leaks.
	 */
	let mounted_components = new WeakMap();

	/**
	 * Unmounts a component that was previously mounted using `mount` or `hydrate`.
	 *
	 * Since 5.13.0, if `options.outro` is `true`, [transitions](https://svelte.dev/docs/svelte/transition) will play before the component is removed from the DOM.
	 *
	 * Returns a `Promise` that resolves after transitions have completed if `options.outro` is true, or immediately otherwise (prior to 5.13.0, returns `void`).
	 *
	 * ```js
	 * import { mount, unmount } from 'svelte';
	 * import App from './App.svelte';
	 *
	 * const app = mount(App, { target: document.body });
	 *
	 * // later...
	 * unmount(app, { outro: true });
	 * ```
	 * @param {Record<string, any>} component
	 * @param {{ outro?: boolean }} [options]
	 * @returns {Promise<void>}
	 */
	function unmount(component, options) {
		const fn = mounted_components.get(component);

		if (fn) {
			mounted_components.delete(component);
			return fn(options);
		}

		return Promise.resolve();
	}

	/** @import { Effect, TemplateNode } from '#client' */

	/**
	 * @param {TemplateNode} node
	 * @param {(branch: (fn: (anchor: Node, elseif?: [number,number]) => void, flag?: boolean) => void) => void} fn
	 * @param {[number,number]} [elseif]
	 * @returns {void}
	 */
	function if_block(node, fn, [root_index, hydrate_index] = [0, 0]) {
		if (hydrating && root_index === 0) {
			hydrate_next();
		}

		var anchor = node;

		/** @type {Effect | null} */
		var consequent_effect = null;

		/** @type {Effect | null} */
		var alternate_effect = null;

		/** @type {UNINITIALIZED | boolean | null} */
		var condition = UNINITIALIZED;

		var flags = root_index > 0 ? EFFECT_TRANSPARENT : 0;

		var has_branch = false;

		const set_branch = (
			/** @type {(anchor: Node, elseif?: [number,number]) => void} */ fn,
			flag = true
		) => {
			has_branch = true;
			update_branch(flag, fn);
		};

		const update_branch = (
			/** @type {boolean | null} */ new_condition,
			/** @type {null | ((anchor: Node, elseif?: [number,number]) => void)} */ fn
		) => {
			if (condition === (condition = new_condition)) return;

			/** Whether or not there was a hydration mismatch. Needs to be a `let` or else it isn't treeshaken out */
			let mismatch = false;

			if (hydrating && hydrate_index !== -1) {
				if (root_index === 0) {
					const data = /** @type {Comment} */ (anchor).data;
					if (data === HYDRATION_START) {
						hydrate_index = 0;
					} else if (data === HYDRATION_START_ELSE) {
						hydrate_index = Infinity;
					} else {
						hydrate_index = parseInt(data.substring(1));
						if (hydrate_index !== hydrate_index) {
							// if hydrate_index is NaN
							// we set an invalid index to force mismatch
							hydrate_index = condition ? Infinity : -1;
						}
					}
				}
				const is_else = hydrate_index > root_index;

				if (!!condition === is_else) {
					// Hydration mismatch: remove everything inside the anchor and start fresh.
					// This could happen with `{#if browser}...{/if}`, for example
					anchor = remove_nodes();

					set_hydrate_node(anchor);
					set_hydrating(false);
					mismatch = true;
					hydrate_index = -1; // ignore hydration in next else if
				}
			}

			if (condition) {
				if (consequent_effect) {
					resume_effect(consequent_effect);
				} else if (fn) {
					consequent_effect = branch(() => fn(anchor));
				}

				if (alternate_effect) {
					pause_effect(alternate_effect, () => {
						alternate_effect = null;
					});
				}
			} else {
				if (alternate_effect) {
					resume_effect(alternate_effect);
				} else if (fn) {
					alternate_effect = branch(() => fn(anchor, [root_index + 1, hydrate_index]));
				}

				if (consequent_effect) {
					pause_effect(consequent_effect, () => {
						consequent_effect = null;
					});
				}
			}

			if (mismatch) {
				// continue in hydration mode
				set_hydrating(true);
			}
		};

		block(() => {
			has_branch = false;
			fn(set_branch);
			if (!has_branch) {
				update_branch(null, null);
			}
		}, flags);

		if (hydrating) {
			anchor = hydrate_node;
		}
	}

	/**
	 * @param {Node} anchor
	 * @param {{ hash: string, code: string }} css
	 */
	function append_styles(anchor, css) {
		// Use `queue_micro_task` to ensure `anchor` is in the DOM, otherwise getRootNode() will yield wrong results
		queue_micro_task(() => {
			var root = anchor.getRootNode();

			var target = /** @type {ShadowRoot} */ (root).host
				? /** @type {ShadowRoot} */ (root)
				: /** @type {Document} */ (root).head ?? /** @type {Document} */ (root.ownerDocument).head;

			// Always querying the DOM is roughly the same perf as additionally checking for presence in a map first assuming
			// that you'll get cache hits half of the time, so we just always query the dom for simplicity and code savings.
			if (!target.querySelector('#' + css.hash)) {
				const style = document.createElement('style');
				style.id = css.hash;
				style.textContent = css.code;

				target.appendChild(style);
			}
		});
	}

	/** @import { ComponentConstructorOptions, ComponentType, SvelteComponent, Component } from 'svelte' */

	/**
	 * Takes the same options as a Svelte 4 component and the component function and returns a Svelte 4 compatible component.
	 *
	 * @deprecated Use this only as a temporary solution to migrate your imperative component code to Svelte 5.
	 *
	 * @template {Record<string, any>} Props
	 * @template {Record<string, any>} Exports
	 * @template {Record<string, any>} Events
	 * @template {Record<string, any>} Slots
	 *
	 * @param {ComponentConstructorOptions<Props> & {
	 * 	component: ComponentType<SvelteComponent<Props, Events, Slots>> | Component<Props>;
	 * }} options
	 * @returns {SvelteComponent<Props, Events, Slots> & Exports}
	 */
	function createClassComponent(options) {
		// @ts-expect-error $$prop_def etc are not actually defined
		return new Svelte4Component(options);
	}

	/**
	 * Support using the component as both a class and function during the transition period
	 * @typedef  {{new (o: ComponentConstructorOptions): SvelteComponent;(...args: Parameters<Component<Record<string, any>>>): ReturnType<Component<Record<string, any>, Record<string, any>>>;}} LegacyComponentType
	 */

	class Svelte4Component {
		/** @type {any} */
		#events;

		/** @type {Record<string, any>} */
		#instance;

		/**
		 * @param {ComponentConstructorOptions & {
		 *  component: any;
		 * }} options
		 */
		constructor(options) {
			var sources = new Map();

			/**
			 * @param {string | symbol} key
			 * @param {unknown} value
			 */
			var add_source = (key, value) => {
				var s = mutable_source(value);
				sources.set(key, s);
				return s;
			};

			// Replicate coarse-grained props through a proxy that has a version source for
			// each property, which is incremented on updates to the property itself. Do not
			// use our $state proxy because that one has fine-grained reactivity.
			const props = new Proxy(
				{ ...(options.props || {}), $$events: {} },
				{
					get(target, prop) {
						return get(sources.get(prop) ?? add_source(prop, Reflect.get(target, prop)));
					},
					has(target, prop) {
						// Necessary to not throw "invalid binding" validation errors on the component side
						if (prop === LEGACY_PROPS) return true;

						get(sources.get(prop) ?? add_source(prop, Reflect.get(target, prop)));
						return Reflect.has(target, prop);
					},
					set(target, prop, value) {
						set(sources.get(prop) ?? add_source(prop, value), value);
						return Reflect.set(target, prop, value);
					}
				}
			);

			this.#instance = (options.hydrate ? hydrate : mount)(options.component, {
				target: options.target,
				anchor: options.anchor,
				props,
				context: options.context,
				intro: options.intro ?? false,
				recover: options.recover
			});

			// We don't flushSync for custom element wrappers or if the user doesn't want it
			if (!options?.props?.$$host || options.sync === false) {
				flushSync();
			}

			this.#events = props.$$events;

			for (const key of Object.keys(this.#instance)) {
				if (key === '$set' || key === '$destroy' || key === '$on') continue;
				define_property(this, key, {
					get() {
						return this.#instance[key];
					},
					/** @param {any} value */
					set(value) {
						this.#instance[key] = value;
					},
					enumerable: true
				});
			}

			this.#instance.$set = /** @param {Record<string, any>} next */ (next) => {
				Object.assign(props, next);
			};

			this.#instance.$destroy = () => {
				unmount(this.#instance);
			};
		}

		/** @param {Record<string, any>} props */
		$set(props) {
			this.#instance.$set(props);
		}

		/**
		 * @param {string} event
		 * @param {(...args: any[]) => any} callback
		 * @returns {any}
		 */
		$on(event, callback) {
			this.#events[event] = this.#events[event] || [];

			/** @param {any[]} args */
			const cb = (...args) => callback.call(this, ...args);
			this.#events[event].push(cb);
			return () => {
				this.#events[event] = this.#events[event].filter(/** @param {any} fn */ (fn) => fn !== cb);
			};
		}

		$destroy() {
			this.#instance.$destroy();
		}
	}

	/**
	 * @typedef {Object} CustomElementPropDefinition
	 * @property {string} [attribute]
	 * @property {boolean} [reflect]
	 * @property {'String'|'Boolean'|'Number'|'Array'|'Object'} [type]
	 */

	/** @type {any} */
	let SvelteElement;

	if (typeof HTMLElement === 'function') {
		SvelteElement = class extends HTMLElement {
			/** The Svelte component constructor */
			$$ctor;
			/** Slots */
			$$s;
			/** @type {any} The Svelte component instance */
			$$c;
			/** Whether or not the custom element is connected */
			$$cn = false;
			/** @type {Record<string, any>} Component props data */
			$$d = {};
			/** `true` if currently in the process of reflecting component props back to attributes */
			$$r = false;
			/** @type {Record<string, CustomElementPropDefinition>} Props definition (name, reflected, type etc) */
			$$p_d = {};
			/** @type {Record<string, EventListenerOrEventListenerObject[]>} Event listeners */
			$$l = {};
			/** @type {Map<EventListenerOrEventListenerObject, Function>} Event listener unsubscribe functions */
			$$l_u = new Map();
			/** @type {any} The managed render effect for reflecting attributes */
			$$me;

			/**
			 * @param {*} $$componentCtor
			 * @param {*} $$slots
			 * @param {*} use_shadow_dom
			 */
			constructor($$componentCtor, $$slots, use_shadow_dom) {
				super();
				this.$$ctor = $$componentCtor;
				this.$$s = $$slots;
				if (use_shadow_dom) {
					this.attachShadow({ mode: 'open' });
				}
			}

			/**
			 * @param {string} type
			 * @param {EventListenerOrEventListenerObject} listener
			 * @param {boolean | AddEventListenerOptions} [options]
			 */
			addEventListener(type, listener, options) {
				// We can't determine upfront if the event is a custom event or not, so we have to
				// listen to both. If someone uses a custom event with the same name as a regular
				// browser event, this fires twice - we can't avoid that.
				this.$$l[type] = this.$$l[type] || [];
				this.$$l[type].push(listener);
				if (this.$$c) {
					const unsub = this.$$c.$on(type, listener);
					this.$$l_u.set(listener, unsub);
				}
				super.addEventListener(type, listener, options);
			}

			/**
			 * @param {string} type
			 * @param {EventListenerOrEventListenerObject} listener
			 * @param {boolean | AddEventListenerOptions} [options]
			 */
			removeEventListener(type, listener, options) {
				super.removeEventListener(type, listener, options);
				if (this.$$c) {
					const unsub = this.$$l_u.get(listener);
					if (unsub) {
						unsub();
						this.$$l_u.delete(listener);
					}
				}
			}

			async connectedCallback() {
				this.$$cn = true;
				if (!this.$$c) {
					// We wait one tick to let possible child slot elements be created/mounted
					await Promise.resolve();
					if (!this.$$cn || this.$$c) {
						return;
					}
					/** @param {string} name */
					function create_slot(name) {
						/**
						 * @param {Element} anchor
						 */
						return (anchor) => {
							const slot = document.createElement('slot');
							if (name !== 'default') slot.name = name;

							append(anchor, slot);
						};
					}
					/** @type {Record<string, any>} */
					const $$slots = {};
					const existing_slots = get_custom_elements_slots(this);
					for (const name of this.$$s) {
						if (name in existing_slots) {
							if (name === 'default' && !this.$$d.children) {
								this.$$d.children = create_slot(name);
								$$slots.default = true;
							} else {
								$$slots[name] = create_slot(name);
							}
						}
					}
					for (const attribute of this.attributes) {
						// this.$$data takes precedence over this.attributes
						const name = this.$$g_p(attribute.name);
						if (!(name in this.$$d)) {
							this.$$d[name] = get_custom_element_value(name, attribute.value, this.$$p_d, 'toProp');
						}
					}
					// Port over props that were set programmatically before ce was initialized
					for (const key in this.$$p_d) {
						// @ts-expect-error
						if (!(key in this.$$d) && this[key] !== undefined) {
							// @ts-expect-error
							this.$$d[key] = this[key]; // don't transform, these were set through JavaScript
							// @ts-expect-error
							delete this[key]; // remove the property that shadows the getter/setter
						}
					}
					this.$$c = createClassComponent({
						component: this.$$ctor,
						target: this.shadowRoot || this,
						props: {
							...this.$$d,
							$$slots,
							$$host: this
						}
					});

					// Reflect component props as attributes
					this.$$me = effect_root(() => {
						render_effect(() => {
							this.$$r = true;
							for (const key of object_keys(this.$$c)) {
								if (!this.$$p_d[key]?.reflect) continue;
								this.$$d[key] = this.$$c[key];
								const attribute_value = get_custom_element_value(
									key,
									this.$$d[key],
									this.$$p_d,
									'toAttribute'
								);
								if (attribute_value == null) {
									this.removeAttribute(this.$$p_d[key].attribute || key);
								} else {
									this.setAttribute(this.$$p_d[key].attribute || key, attribute_value);
								}
							}
							this.$$r = false;
						});
					});

					for (const type in this.$$l) {
						for (const listener of this.$$l[type]) {
							const unsub = this.$$c.$on(type, listener);
							this.$$l_u.set(listener, unsub);
						}
					}
					this.$$l = {};
				}
			}

			// We don't need this when working within Svelte code, but for compatibility of people using this outside of Svelte
			// and setting attributes through setAttribute etc, this is helpful

			/**
			 * @param {string} attr
			 * @param {string} _oldValue
			 * @param {string} newValue
			 */
			attributeChangedCallback(attr, _oldValue, newValue) {
				if (this.$$r) return;
				attr = this.$$g_p(attr);
				this.$$d[attr] = get_custom_element_value(attr, newValue, this.$$p_d, 'toProp');
				this.$$c?.$set({ [attr]: this.$$d[attr] });
			}

			disconnectedCallback() {
				this.$$cn = false;
				// In a microtask, because this could be a move within the DOM
				Promise.resolve().then(() => {
					if (!this.$$cn && this.$$c) {
						this.$$c.$destroy();
						this.$$me();
						this.$$c = undefined;
					}
				});
			}

			/**
			 * @param {string} attribute_name
			 */
			$$g_p(attribute_name) {
				return (
					object_keys(this.$$p_d).find(
						(key) =>
							this.$$p_d[key].attribute === attribute_name ||
							(!this.$$p_d[key].attribute && key.toLowerCase() === attribute_name)
					) || attribute_name
				);
			}
		};
	}

	/**
	 * @param {string} prop
	 * @param {any} value
	 * @param {Record<string, CustomElementPropDefinition>} props_definition
	 * @param {'toAttribute' | 'toProp'} [transform]
	 */
	function get_custom_element_value(prop, value, props_definition, transform) {
		const type = props_definition[prop]?.type;
		value = type === 'Boolean' && typeof value !== 'boolean' ? value != null : value;
		if (!transform || !props_definition[prop]) {
			return value;
		} else if (transform === 'toAttribute') {
			switch (type) {
				case 'Object':
				case 'Array':
					return value == null ? null : JSON.stringify(value);
				case 'Boolean':
					return value ? '' : null;
				case 'Number':
					return value == null ? null : value;
				default:
					return value;
			}
		} else {
			switch (type) {
				case 'Object':
				case 'Array':
					return value && JSON.parse(value);
				case 'Boolean':
					return value; // conversion already handled above
				case 'Number':
					return value != null ? +value : value;
				default:
					return value;
			}
		}
	}

	/**
	 * @param {HTMLElement} element
	 */
	function get_custom_elements_slots(element) {
		/** @type {Record<string, true>} */
		const result = {};
		element.childNodes.forEach((node) => {
			result[/** @type {Element} node */ (node).slot || 'default'] = true;
		});
		return result;
	}

	/**
	 * @internal
	 *
	 * Turn a Svelte component into a custom element.
	 * @param {any} Component  A Svelte component function
	 * @param {Record<string, CustomElementPropDefinition>} props_definition  The props to observe
	 * @param {string[]} slots  The slots to create
	 * @param {string[]} exports  Explicitly exported values, other than props
	 * @param {boolean} use_shadow_dom  Whether to use shadow DOM
	 * @param {(ce: new () => HTMLElement) => new () => HTMLElement} [extend]
	 */
	function create_custom_element(
		Component,
		props_definition,
		slots,
		exports,
		use_shadow_dom,
		extend
	) {
		let Class = class extends SvelteElement {
			constructor() {
				super(Component, slots, use_shadow_dom);
				this.$$p_d = props_definition;
			}
			static get observedAttributes() {
				return object_keys(props_definition).map((key) =>
					(props_definition[key].attribute || key).toLowerCase()
				);
			}
		};
		object_keys(props_definition).forEach((prop) => {
			define_property(Class.prototype, prop, {
				get() {
					return this.$$c && prop in this.$$c ? this.$$c[prop] : this.$$d[prop];
				},
				set(value) {
					value = get_custom_element_value(prop, value, props_definition);
					this.$$d[prop] = value;
					var component = this.$$c;

					if (component) {
						// // If the instance has an accessor, use that instead
						var setter = get_descriptor(component, prop)?.get;

						if (setter) {
							component[prop] = value;
						} else {
							component.$set({ [prop]: value });
						}
					}
				}
			});
		});
		exports.forEach((property) => {
			define_property(Class.prototype, property, {
				get() {
					return this.$$c?.[property];
				}
			});
		});
		Component.element = /** @type {any} */ Class;
		return Class;
	}

	var root_1 = template(`<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.5/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-SgOJa3DmI69IUzQ2PVdRZhwQ+dy64/BUtbMJw1MZ8t5HZApcHrRKUc4W0kG879m7" crossorigin="anonymous">`);

	var root_6 = template(
		`<b>Fully Fundable</b>&mdash;we can fund the entire
						purchase and rehab cost in draws: <table class="table table-sm w-75 mx-auto mt-3 mb-2 table-success"><tbody><tr><td>Purchase <small>(80% of as-is)</small></td><td class="text-end"> </td></tr><tr><td>Rehab draws</td><td class="text-end"> </td></tr></tbody><tfoot class="table-group-divider fw-bold"><tr><td>Total loan amount</td><td class="text-end"> </td></tr></tfoot></table>`,
		1
	);

	var root_9 = template(
		`<b>Fundable with downpayment</b>&mdash;we can fund if
						you provide a <b> </b> downpayment to bring our loan to 80% of as-is: <table class="table table-sm w-75 mx-auto mt-3 mb-2 table-warning"><tbody><tr><td>Purchase <small>(80% of as-is)</small></td><td class="text-end"> </td></tr><tr><td>Rehab draws</td><td class="text-end"> </td></tr></tbody><tfoot class="table-group-divider fw-bold"><tr><td>Total loan amount</td><td class="text-end"> </td></tr></tfoot></table>`,
		1
	);

	var root_11 = template(
		`<b>Sorry, not fundable</b>&mdash;you're buying above the
						as-is value, with a high chance of losing money.`,
		1
	);

	var root_3 = template(`<div class="input-group mb-3"><span class="input-group-text">$</span> <div class="form-floating"><!> <label for="arvInput">After Repair Value (ARV)</label></div></div> <div class="input-group mb-3"><span class="input-group-text">$</span> <div class="form-floating"><!> <label for="rehabInput">Rehab Amount</label></div></div> <div class="input-group"><span class="input-group-text">$</span> <div class="form-floating"><!> <label for="purchaseInput">Purchase Price</label></div></div> <!>`, 1);
	var root_14 = template(`No rehab? We fund 70% of the current value: <b style="display:block" class="pt-2"> </b>`, 1);
	var root_12 = template(`<div class="input-group"><span class="input-group-text">$</span> <div class="form-floating"><!> <label for="noRehabValueInput">Current Value</label></div></div> <!>`, 1);
	var root_2 = template(`<!> <!>`, 1);
	var root = template(`<div class="container mt-3 mb-5"><!> <div class="text-center"><!> <!></div></div>`);

	const $$css = {
		hash: 'svelte-y1a46t',
		code: ':root {--bs-primary: rgb(83, 61, 34) !important;--bs-body-color: rgb(122, 122, 122) !important;--bs-font-sans-serif: Poppins, Arial, sans-serif !important;}'
	};

	function Embed($$anchor, $$props) {
		push($$props, true);
		append_styles($$anchor, $$css);

		const minLoanAmount = 10000;
		const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
		let arvAmount = state(null);
		let rehabAmount = state(null);
		let purchaseAmount = state(null);
		let noRehabValue = state(null);
		let asIsValue = user_derived(() => 0.7 * get(arvAmount) - get(rehabAmount));
		let depth = user_derived(() => get(purchaseAmount) / get(asIsValue));
		let purchaseDraw = user_derived(() => 0.8 * get(asIsValue));
		let totalLoanAmount = user_derived(() => get(purchaseDraw) + get(rehabAmount));
		let downpaymentNeededAmount = user_derived(() => get(purchaseAmount) - 0.8 * get(asIsValue));
		let noRehabLoanAmount = user_derived(() => 0.7 * get(noRehabValue));

		function setExample() {
			set(arvAmount, 200000.0);
			set(noRehabValue, 100000.0);
			set(rehabAmount, 10000.0);
			set(purchaseAmount, 80000.0);
		}

		function clearScenario() {
			set(arvAmount, null);
			set(noRehabValue, null);
			set(rehabAmount, null);
			set(purchaseAmount, null);
		}

		var div = root();

		head(($$anchor) => {
			var link = root_1();

			$document.title = 'Stoplight Analyzer';
			append($$anchor, link);
		});

		var node = child(div);

		sveltestrap.TabContent(node, {
			children: ($$anchor, $$slotProps) => {
				var fragment = root_2();
				var node_1 = first_child(fragment);

				sveltestrap.TabPane(node_1, {
					tabId: 'rehabRequired',
					tab: 'Rehab Required',
					active: true,
					class: 'p-4',
					children: ($$anchor, $$slotProps) => {
						var fragment_1 = root_3();
						var div_1 = first_child(fragment_1);
						var div_2 = sibling(child(div_1), 2);
						var node_2 = child(div_2);

						sveltestrap.Input(node_2, {
							placeholder: 'After Repair Value (ARV)',
							min: 10000,
							type: 'number',
							step: '1',
							id: 'arvInput',
							get value() {
								return get(arvAmount);
							},
							set value($$value) {
								set(arvAmount, $$value, true);
							}
						});

						next(2);
						reset(div_2);
						reset(div_1);

						var div_3 = sibling(div_1, 2);
						var div_4 = sibling(child(div_3), 2);
						var node_3 = child(div_4);

						sveltestrap.Input(node_3, {
							placeholder: 'Rehab Amount',
							min: 10000,
							type: 'number',
							step: '1',
							id: 'rehabInput',
							get value() {
								return get(rehabAmount);
							},
							set value($$value) {
								set(rehabAmount, $$value, true);
							}
						});

						next(2);
						reset(div_4);
						reset(div_3);

						var div_5 = sibling(div_3, 2);
						var div_6 = sibling(child(div_5), 2);
						var node_4 = child(div_6);

						sveltestrap.Input(node_4, {
							placeholder: 'Purchase Price',
							min: 10000,
							type: 'number',
							step: '1',
							id: 'purchaseInput',
							get value() {
								return get(purchaseAmount);
							},
							set value($$value) {
								set(purchaseAmount, $$value, true);
							}
						});

						next(2);
						reset(div_6);
						reset(div_5);

						var node_5 = sibling(div_5, 2);

						{
							var consequent_2 = ($$anchor) => {
								var fragment_2 = comment();
								var node_6 = first_child(fragment_2);

								{
									var consequent = ($$anchor) => {
										sveltestrap.Alert($$anchor, {
											color: 'success',
											class: 'mt-4',
											children: ($$anchor, $$slotProps) => {
												var fragment_4 = root_6();
												var table = sibling(first_child(fragment_4), 2);
												var tbody = child(table);
												var tr = child(tbody);
												var td = sibling(child(tr));
												var text = child(td, true);

												reset(td);
												reset(tr);

												var tr_1 = sibling(tr);
												var td_1 = sibling(child(tr_1));
												var text_1 = child(td_1, true);

												reset(td_1);
												reset(tr_1);
												reset(tbody);

												var tfoot = sibling(tbody);
												var tr_2 = child(tfoot);
												var td_2 = sibling(child(tr_2));
												var text_2 = child(td_2, true);

												reset(td_2);
												reset(tr_2);
												reset(tfoot);
												reset(table);

												template_effect(
													($0, $1, $2) => {
														set_text(text, $0);
														set_text(text_1, $1);
														set_text(text_2, $2);
													},
													[
														() => currency.format(get(purchaseDraw)),
														() => currency.format(get(rehabAmount)),
														() => currency.format(get(totalLoanAmount))
													]
												);

												append($$anchor, fragment_4);
											},
											$$slots: { default: true }
										});
									};

									var alternate = ($$anchor, $$elseif) => {
										{
											var consequent_1 = ($$anchor) => {
												sveltestrap.Alert($$anchor, {
													color: 'warning',
													class: 'mt-4',
													children: ($$anchor, $$slotProps) => {
														var fragment_6 = root_9();
														var b = sibling(first_child(fragment_6), 2);
														var text_3 = child(b, true);

														reset(b);

														var table_1 = sibling(b, 2);
														var tbody_1 = child(table_1);
														var tr_3 = child(tbody_1);
														var td_3 = sibling(child(tr_3));
														var text_4 = child(td_3, true);

														reset(td_3);
														reset(tr_3);

														var tr_4 = sibling(tr_3);
														var td_4 = sibling(child(tr_4));
														var text_5 = child(td_4, true);

														reset(td_4);
														reset(tr_4);
														reset(tbody_1);

														var tfoot_1 = sibling(tbody_1);
														var tr_5 = child(tfoot_1);
														var td_5 = sibling(child(tr_5));
														var text_6 = child(td_5, true);

														reset(td_5);
														reset(tr_5);
														reset(tfoot_1);
														reset(table_1);

														template_effect(
															($0, $1, $2, $3) => {
																set_text(text_3, $0);
																set_text(text_4, $1);
																set_text(text_5, $2);
																set_text(text_6, $3);
															},
															[
																() => currency.format(get(downpaymentNeededAmount)),
																() => currency.format(get(purchaseDraw)),
																() => currency.format(get(rehabAmount)),
																() => currency.format(get(totalLoanAmount))
															]
														);

														append($$anchor, fragment_6);
													},
													$$slots: { default: true }
												});
											};

											var alternate_1 = ($$anchor) => {
												sveltestrap.Alert($$anchor, {
													color: 'danger',
													class: 'mt-4 text-center',
													children: ($$anchor, $$slotProps) => {
														var fragment_8 = root_11();

														next();
														append($$anchor, fragment_8);
													},
													$$slots: { default: true }
												});
											};

											if_block(
												$$anchor,
												($$render) => {
													if (get(depth) <= 1.0) $$render(consequent_1); else $$render(alternate_1, false);
												},
												$$elseif
											);
										}
									};

									if_block(node_6, ($$render) => {
										if (get(depth) <= 0.8) $$render(consequent); else $$render(alternate, false);
									});
								}

								append($$anchor, fragment_2);
							};

							if_block(node_5, ($$render) => {
								if (get(totalLoanAmount) > minLoanAmount) $$render(consequent_2);
							});
						}

						append($$anchor, fragment_1);
					},
					$$slots: { default: true }
				});

				var node_7 = sibling(node_1, 2);

				sveltestrap.TabPane(node_7, {
					tabId: 'noRehab',
					tab: 'No Rehab',
					class: 'p-4',
					children: ($$anchor, $$slotProps) => {
						var fragment_9 = root_12();
						var div_7 = first_child(fragment_9);
						var div_8 = sibling(child(div_7), 2);
						var node_8 = child(div_8);

						sveltestrap.Input(node_8, {
							placeholder: 'Current Value',
							min: 10000,
							type: 'number',
							step: '1',
							id: 'noRehabValueInput',
							get value() {
								return get(noRehabValue);
							},
							set value($$value) {
								set(noRehabValue, $$value, true);
							}
						});

						next(2);
						reset(div_8);
						reset(div_7);

						var node_9 = sibling(div_7, 2);

						{
							var consequent_3 = ($$anchor) => {
								sveltestrap.Alert($$anchor, {
									color: 'primary',
									class: 'mt-4 text-center',
									children: ($$anchor, $$slotProps) => {
										next();

										var fragment_11 = root_14();
										var b_1 = sibling(first_child(fragment_11));
										var text_7 = child(b_1, true);

										reset(b_1);

										template_effect(($0) => set_text(text_7, $0), [
											() => currency.format(get(noRehabLoanAmount))
										]);

										append($$anchor, fragment_11);
									},
									$$slots: { default: true }
								});
							};

							if_block(node_9, ($$render) => {
								if (get(noRehabLoanAmount) > minLoanAmount) $$render(consequent_3);
							});
						}

						append($$anchor, fragment_9);
					},
					$$slots: { default: true }
				});

				append($$anchor, fragment);
			},
			$$slots: { default: true }
		});

		var div_9 = sibling(node, 2);
		var node_10 = child(div_9);

		sveltestrap.Button(node_10, {
			outline: true,
			class: 'btn-sm mx-2',
			onclick: clearScenario,
			children: ($$anchor, $$slotProps) => {
				next();

				var text_8 = text('Clear Scenario');

				append($$anchor, text_8);
			},
			$$slots: { default: true }
		});

		var node_11 = sibling(node_10, 2);

		sveltestrap.Button(node_11, {
			outline: true,
			class: 'btn-sm mx-2',
			onclick: setExample,
			children: ($$anchor, $$slotProps) => {
				next();

				var text_9 = text('Show Example');

				append($$anchor, text_9);
			},
			$$slots: { default: true }
		});

		reset(div_9);
		reset(div);
		append($$anchor, div);
		pop();
	}

	create_custom_element(Embed, {}, [], [], true);

	svelteRetag({
		component: Embed,
		tagname: 'stoplight-analyzer-widget',
		shadow: false // Use the light DOM
	});

})(sveltestrap);
