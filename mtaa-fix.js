const reportForm = document.querySelector("#reportForm");
const reportList = document.querySelector("#reportList");
const reportCount = document.querySelector("#reportCount");
const filterButtons = document.querySelectorAll("[data-filter]");
const emptyState = document.querySelector("#emptyState");
const toast = document.querySelector("#toast");

let reports = [];
let activeFilter = "All reports";

function showToast(message) {
	toast.textContent = message;
	toast.classList.add("is-visible");
	window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function getPriority(report) {
	if (report.confirmations >= 20) return "High priority";
	if (report.confirmations >= 10) return "Rising";
	return "Needs eyes";
}

function renderReports() {
	const visibleReports = reports.filter(report => {
		if (activeFilter === "All reports") return true;
		if (activeFilter === "High priority") return report.confirmations >= 20;
		return report.category === activeFilter;
	});

	reportList.innerHTML = visibleReports.map(report => `
		<article class="report-card" data-report-id="${report.id}">
			<div class="report-card__visual report-card__visual--${report.color}">
				<span class="report-icon" aria-hidden="true">${report.icon === "light" ? "✦" : report.icon === "road" ? "⌁" : "≈"}</span>
				<span class="report-card__number">#${String(report.id).padStart(3, "0")}</span>
			</div>
			<div class="report-card__body">
				<div class="report-card__topline"><span class="status-dot status-dot--${report.status === "In progress" ? "progress" : "open"}"></span><span>${report.status}</span><span class="report-time">${report.createdAt ? new Date(report.createdAt).toLocaleDateString() : "Just now"}</span></div>
			<h3>${report.title}</h3>
			<p class="report-location">⌖ ${report.location}</p>
			<div class="report-meta"><span>${report.category}</span><span class="severity severity--${report.severity.toLowerCase()}">${report.severity}</span></div>
			<div class="report-card__footer"><span class="priority priority--${report.confirmations >= 20 ? "high" : "normal"}">${getPriority(report)}</span><button class="confirm-button" type="button" data-confirm="${report.id}">Confirm <strong>${report.confirmations}</strong></button></div>
			<div class="report-progress" aria-label="${report.confirmations} community confirmations"><span style="width: ${Math.min(report.confirmations * 3, 100)}%"></span></div>
			${report.confirmations >= 20 ? '<p class="priority-note">Community signal is strong. This report has been escalated.</p>' : ""}
			</div>
		</article>
	`).join("");

	emptyState.hidden = visibleReports.length > 0;
	reportCount.textContent = `${reports.length} active reports`;
}

filterButtons.forEach(button => {
	button.addEventListener("click", () => {
		activeFilter = button.dataset.filter;
		filterButtons.forEach(item => item.classList.toggle("is-active", item === button));
		renderReports();
	});
});

reportList.addEventListener("click", event => {
	const button = event.target.closest("[data-confirm]");
	if (!button) return;

	const report = reports.find(item => item.id === Number(button.dataset.confirm));
	if (!report) return;

	fetch(`/api/reports/${report.id}/confirm`, { method: "POST" })
		.then(response => {
			if (!response.ok) throw new Error("Unable to confirm this report.");
			return response.json();
		})
		.then(result => {
			report.confirmations = result.confirmations;
			if (result.highPriority) showToast("High priority reached. This report is now escalated.");
			else showToast("Thanks for confirming your neighbour's report.");
			renderReports();
		})
		.catch(error => showToast(error.message));
});

reportForm.addEventListener("submit", async event => {
	event.preventDefault();
	const formData = new FormData(reportForm);
	const category = formData.get("category");
	const description = formData.get("description").trim();
	const location = formData.get("location").trim();
	const file = formData.get("photo");
	const categoryData = {
		Streetlight: ["light", "yellow"],
		Roads: ["road", "coral"],
		Drainage: ["water", "blue"],
		Waste: ["waste", "mint"],
		Water: ["water", "blue"],
		Safety: ["safety", "coral"]
	};
	const [icon, color] = categoryData[category] || ["road", "coral"];

	if (!description || !location) {
		showToast("Add a description and location before submitting.");
		return;
	}

	try {
		const response = await fetch("/api/reports", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ category, description, location, photo: file?.name || "" })
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error || "Unable to submit the report.");

		reports.unshift(result);
		reportForm.reset();
		renderReports();
		showToast("Report received. Neighbours can now confirm it.");
		document.querySelector("#reports").scrollIntoView({ behavior: "smooth" });
	} catch (error) {
		showToast(error.message);
	}
});

async function loadReports() {
	try {
		const response = await fetch("/api/reports");
		if (!response.ok) throw new Error("Unable to load community reports.");
		reports = await response.json();
		renderReports();
	} catch (error) {
		showToast(error.message);
	}
}

loadReports();
