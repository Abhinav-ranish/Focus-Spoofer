document.addEventListener('DOMContentLoaded', () => {
    const domainInput = document.getElementById('domainInput');
    const addBtn = document.getElementById('addBtn');
    const domainList = document.getElementById('domainList');
    const emptyState = document.getElementById('emptyState');

    // Load initial list
    loadDomains();

    addBtn.addEventListener('click', () => {
        addDomain();
    });

    domainInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addDomain();
    });

    function loadDomains() {
        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            const domains = result.alwaysOnDomains || [];
            renderList(domains);
        });
    }

    function addDomain() {
        const raw = domainInput.value.trim();
        if (!raw) return;

        // Simple validation/cleanup
        // Remove http/https/www if present for cleaner matching logic
        let domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
        // Remove path
        domain = domain.split('/')[0];

        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            const domains = result.alwaysOnDomains || [];
            if (!domains.includes(domain)) {
                domains.push(domain);
                chrome.storage.sync.set({ alwaysOnDomains: domains }, () => {
                    domainInput.value = '';
                    renderList(domains);
                });
            }
        });
    }

    function removeDomain(domain) {
        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            let domains = result.alwaysOnDomains || [];
            domains = domains.filter(d => d !== domain);
            chrome.storage.sync.set({ alwaysOnDomains: domains }, () => {
                renderList(domains);
            });
        });
    }

    function renderList(domains) {
        domainList.innerHTML = '';

        if (domains.length === 0) {
            emptyState.style.display = 'block';
            return;
        }
        emptyState.style.display = 'none';

        domains.forEach(domain => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${domain}</span>
                <button class="remove-btn" data-domain="${domain}">Remove</button>
            `;
            domainList.appendChild(li);
        });

        // Add delete listeners
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                removeDomain(e.target.getAttribute('data-domain'));
            });
        });
    }
});
