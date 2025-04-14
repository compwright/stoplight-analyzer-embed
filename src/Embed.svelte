<script>
	import {
		Alert,
		Button,
		TabContent,
		TabPane,
		Input,
	} from "@sveltestrap/sveltestrap";

	const minLoanAmount = 10000;

	const currency = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	});

	let arvAmount = $state(null);
	let rehabAmount = $state(null);
	let purchaseAmount = $state(null);
	let noRehabValue = $state(null);

	let asIsValue = $derived(0.7 * arvAmount - rehabAmount);
	let depth = $derived(purchaseAmount / asIsValue);
	let purchaseDraw = $derived(0.8 * asIsValue);
	let totalLoanAmount = $derived(purchaseDraw + rehabAmount);
	let downpaymentNeededAmount = $derived(purchaseAmount - 0.8 * asIsValue);

	let noRehabLoanAmount = $derived(0.7 * noRehabValue);

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

<svelte:head>
	<title>Stoplight Analyzer</title>
	<link
		href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.5/dist/css/bootstrap.min.css"
		rel="stylesheet"
		integrity="sha384-SgOJa3DmI69IUzQ2PVdRZhwQ+dy64/BUtbMJw1MZ8t5HZApcHrRKUc4W0kG879m7"
		crossorigin="anonymous"
	/>
</svelte:head>

<div class="container mt-3 mb-5">
	<TabContent>
		<TabPane tabId="rehabRequired" tab="Rehab Required" active class="p-4">
			<div class="input-group mb-3">
				<span class="input-group-text">$</span>
				<div class="form-floating">
					<Input
						placeholder="After Repair Value (ARV)"
						min={10000}
						type="number"
						step="1"
						id="arvInput"
						bind:value={arvAmount}
					/>
					<label for="arvInput">After Repair Value (ARV)</label>
				</div>
			</div>
			<div class="input-group mb-3">
				<span class="input-group-text">$</span>
				<div class="form-floating">
					<Input
						placeholder="Rehab Amount"
						min={10000}
						type="number"
						step="1"
						id="rehabInput"
						bind:value={rehabAmount}
					/>
					<label for="rehabInput">Rehab Amount</label>
				</div>
			</div>
			<div class="input-group">
				<span class="input-group-text">$</span>
				<div class="form-floating">
					<Input
						placeholder="Purchase Price"
						min={10000}
						type="number"
						step="1"
						id="purchaseInput"
						bind:value={purchaseAmount}
					/>
					<label for="purchaseInput">Purchase Price</label>
				</div>
			</div>
			{#if totalLoanAmount > minLoanAmount}
				{#if depth <= 0.8}
					<Alert color="success" class="mt-4">
						<b>Fully Fundable</b>&mdash;we can fund the entire
						purchase and rehab cost in draws:
						<table class="table table-sm w-75 mx-auto mt-3 mb-2 table-success">
							<tbody>
								<tr>
									<td>
										Purchase <small>(80% of as-is)</small>
									</td>
									<td class="text-end">
										{currency.format(purchaseDraw)}
									</td>
								</tr>
								<tr>
									<td>Rehab draws</td>
									<td class="text-end">
										{currency.format(rehabAmount)}
									</td>
								</tr>
							</tbody>
							<tfoot class="table-group-divider fw-bold">
								<tr>
									<td>Total loan amount</td>
									<td class="text-end">
										{currency.format(totalLoanAmount)}
									</td>
								</tr>
							</tfoot>
						</table>
					</Alert>
				{:else if depth <= 1.0}
					<Alert color="warning" class="mt-4">
						<b>Fundable with downpayment</b>&mdash;we can fund if
						you provide a
						<b>{currency.format(downpaymentNeededAmount)}</b>
						downpayment to bring our loan to 80% of as-is:
						<table class="table table-sm w-75 mx-auto mt-3 mb-2 table-warning">
							<tbody>
								<tr>
									<td>
										Purchase <small>(80% of as-is)</small>
									</td>
									<td class="text-end">
										{currency.format(purchaseDraw)}
									</td>
								</tr>
								<tr>
									<td>Rehab draws</td>
									<td class="text-end">
										{currency.format(rehabAmount)}
									</td>
								</tr>
							</tbody>
							<tfoot class="table-group-divider fw-bold">
								<tr>
									<td>Total loan amount</td>
									<td class="text-end">
										{currency.format(totalLoanAmount)}
									</td>
								</tr>
							</tfoot>
						</table>
					</Alert>
				{:else}
					<Alert color="danger" class="mt-4 text-center">
						<b>Sorry, not fundable</b>&mdash;you're buying above the
						as-is value, with a high chance of losing money.
					</Alert>
				{/if}
			{/if}
		</TabPane>

		<TabPane tabId="noRehab" tab="No Rehab" class="p-4">
			<div class="input-group">
				<span class="input-group-text">$</span>
				<div class="form-floating">
					<Input
						placeholder="Current Value"
						min={10000}
						type="number"
						step="1"
						id="noRehabValueInput"
						bind:value={noRehabValue}
					/>
					<label for="noRehabValueInput">Current Value</label>
				</div>
			</div>
			{#if noRehabLoanAmount > minLoanAmount}
				<Alert color="primary" class="mt-4 text-center">
					No rehab? We fund 70% of the current value:
					<b style="display:block" class="pt-2">
						{currency.format(noRehabLoanAmount)}
					</b>
				</Alert>
			{/if}
		</TabPane>
	</TabContent>

	<div class="text-center">
		<Button outline class="btn-sm mx-2" onclick={clearScenario}>
			Clear Scenario
		</Button>
		<Button outline class="btn-sm mx-2" onclick={setExample}>
			Show Example
		</Button>
	</div>
</div>

<style global lang="scss">
	:root {
		--bs-primary: rgb(83, 61, 34) !important;
		--bs-body-color: rgb(122, 122, 122) !important;
		--bs-font-sans-serif: Poppins, Arial, sans-serif !important;
	}
</style>
