<svelte:options customElement="stoplight-analyzer" />

<script>
	const minLoanAmount = 10000;

	const currency = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD'
	});

	let rehabRequired = $state(true);

	let arvAmount = $state(null);
	let rehabAmount = $state(null);
	let purchaseAmount = $state(null);
	let noRehabValue = $state(null);

	let asIsValue = $derived(0.7 * arvAmount - rehabAmount);
	let depth = $derived(100 * purchaseAmount / asIsValue);
	let purchaseDraw = $derived(0.8 * asIsValue);
	let totalLoanAmount = $derived(purchaseDraw + rehabAmount);
	let downpaymentNeededAmount = $derived(purchaseAmount - 0.8 * asIsValue);

	let noRehabLoanAmount = $derived(0.7 * noRehabValue);

	function setRehabRequired() {
		rehabRequired = true;
	}

	function setNoRehab() {
		rehabRequired = false;
	}

	function setExample() {
		arvAmount = 200000.0;
		noRehabValue = 100000.0;
		rehabAmount = 10000.0;
		purchaseAmount = 80000.0;
	}

	function clearScenario() {
		arvAmount = null;
		noRehabValue = null;
		rehabAmount = null;
		purchaseAmount = null;
	}
</script>

<style global lang="scss">
	@import "./styles.scss";
</style>

<svelte:head>
	<title>Stoplight Analyzer</title>
	<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Poppins:400,500,600,700,800,900&display=swap" media="all">
</svelte:head>

{#snippet depthCalc()}
	<tbody>
		<tr>
			<td>As-Is Value <small>(0.7*ARV - rehab)</small></td>
			<td class="text-end">{currency.format(asIsValue)}</td>
		</tr>
		<tr>
			<td>Depth <small>(Purchase Price &div; As-is value)</small></td>
			<td class="text-end">{depth.toFixed(1)}%</td>
		</tr>
	</tbody>
{/snippet}

{#snippet loanCalc()}
	<tbody class="table-group-divider">
		<tr>
			<td>Purchase <small>(80% of as-is)</small></td>
			<td class="text-end">{currency.format(purchaseDraw)}</td>
		</tr>
		<tr>
			<td>Rehab Amount</td>
			<td class="text-end">{currency.format(rehabAmount)}</td>
		</tr>
	</tbody>
	<tfoot class="table-group-divider fw-bold">
		<tr>
			<td>Total loan amount</td>
			<td class="text-end">{currency.format(totalLoanAmount)}</td>
		</tr>
	</tfoot>
{/snippet}

<div data-bs-theme="light">
	<div class="container mt-3 mb-5">
		<nav class="nav nav-underline">
			<div class="nav-item">
				<button class="nav-link" class:active={rehabRequired} onclick={setRehabRequired}>
					Rehab Required
				</button>
			</div>
			<div class="nav-item">
				<button class="nav-link" class:active={!rehabRequired} onclick={setNoRehab}>
					No Rehab
				</button>
			</div>
		</nav>

		{#if rehabRequired}
			<div class="p-4">
				<div class="input-group mb-3">
					<span class="input-group-text">$</span>
					<div class="form-floating">
						<input placeholder="After Repair Value (ARV)" class="form-control" min={10000} type="number" step="1" id="arvInput" bind:value={arvAmount} />
						<label for="arvInput">After Repair Value (ARV)</label>
					</div>
				</div>
				<div class="input-group mb-3">
					<span class="input-group-text">$</span>
					<div class="form-floating">
						<input placeholder="Rehab Amount" class="form-control" min={10000} type="number" step="1" id="rehabInput" bind:value={rehabAmount} />
						<label for="rehabInput">Rehab Amount</label>
					</div>
				</div>
				<div class="input-group">
					<span class="input-group-text">$</span>
					<div class="form-floating">
						<input placeholder="Purchase Price" class="form-control" min={10000} type="number" step="1" id="purchaseInput" bind:value={purchaseAmount} />
						<label for="purchaseInput">Purchase Price</label>
					</div>
				</div>
				{#if totalLoanAmount > minLoanAmount}
					{#if depth <= 80}
						<div class="alert alert-success mt-4">
							<b>Fully Fundable</b>&mdash;we can fund the entire purchase and rehab cost:
							<table class="table table-sm w-100 mx-auto mt-3 mb-2 table-success">
								{@render depthCalc()}
								{@render loanCalc()}
							</table>
						</div>
					{:else if depth <= 100}
						<div class="alert alert-warning mt-4">
							<b>Fundable with downpayment</b>&mdash;we can fund if you provide a
							<b>{currency.format(downpaymentNeededAmount)}</b> downpayment
							to bring our loan to 80% of as-is:
							<table class="table table-sm w-100 mx-auto mt-3 mb-2 table-warning">
								{@render depthCalc()}
								{@render loanCalc()}
							</table>
						</div>
					{:else}
						<div class="alert alert-danger mt-4">
							<b>Sorry, not fundable</b>&mdash;you're buying above the as-is value,
							with a high chance of losing money.
							<table class="table table-sm w-100 mx-auto mt-3 mb-2 table-danger">
								{@render depthCalc()}
							</table>
						</div>
					{/if}
				{/if}
			</div>
		{:else}
			<div class="p-4">
				<div class="input-group">
					<span class="input-group-text">$</span>
					<div class="form-floating">
						<input placeholder="Current Value" class="form-control" min={10000} type="number" step="1" id="noRehabValueInput" bind:value={noRehabValue} />
						<label for="noRehabValueInput">Current Value</label>
					</div>
				</div>
				{#if noRehabLoanAmount > minLoanAmount}
					<div class="alert alert-primary mt-4 text-center">
						No rehab? We fund 70% of the current value:
						<b style="display:block" class="pt-2">{currency.format(noRehabLoanAmount)}</b>
					</div>
				{/if}
			</div>
		{/if}

		<div class="text-center">
			<button class="btn btn-outline-secondary btn-sm mx-2" onclick={clearScenario}>
				Clear Scenario
			</button>
			<button class="btn btn-outline-secondary btn-sm mx-2" onclick={setExample}>
				Show Example
			</button>
		</div>
	</div>
</div>
