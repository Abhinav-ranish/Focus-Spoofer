document.addEventListener('DOMContentLoaded', () => {
    const domainInput = document.getElementById('domainInput');
    const addBtn = document.getElementById('addBtn');
    const domainList = document.getElementById('domainList');
    const emptyState = document.getElementById('emptyState');
    const listHeader = document.getElementById('listHeader');

    loadDomains();

    addBtn.addEventListener('click', addDomain);
    domainInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addDomain();
    });

    function loadDomains() {
        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            renderList(result.alwaysOnDomains || []);
        });
    }

    // Normalise free-form input into a bare hostname and reject anything that
    // isn't a plausible domain (also prevents junk/markup from being stored).
    function normalizeDomain(raw) {
        let domain = raw.trim().toLowerCase();
        if (!domain) return null;
        domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
        domain = domain.split('/')[0].split('?')[0].split('#')[0];
        domain = domain.split(':')[0]; // strip any port
        // Letters/digits/hyphens per label, at least one dot, valid TLD.
        if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
            return null;
        }
        return domain;
    }

    function addDomain() {
        const domain = normalizeDomain(domainInput.value);
        if (!domain) {
            domainInput.focus();
            domainInput.select();
            return;
        }

        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            const domains = result.alwaysOnDomains || [];
            if (!domains.includes(domain)) {
                domains.push(domain);
                chrome.storage.sync.set({ alwaysOnDomains: domains }, () => {
                    domainInput.value = '';
                    renderList(domains);
                });
            } else {
                domainInput.value = '';
            }
        });
    }

    function removeDomain(domain) {
        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            const domains = (result.alwaysOnDomains || []).filter(d => d !== domain);
            chrome.storage.sync.set({ alwaysOnDomains: domains }, () => renderList(domains));
        });
    }

    function renderList(domains) {
        domainList.textContent = '';

        if (domains.length === 0) {
            emptyState.style.display = 'block';
            if (listHeader) listHeader.style.display = 'none';
            return;
        }
        emptyState.style.display = 'none';
        if (listHeader) listHeader.style.display = 'block';

        domains.forEach(domain => {
            const li = document.createElement('li');

            const name = document.createElement('span');
            name.className = 'domain-name';
            name.textContent = domain; // textContent — never inject markup

            const btn = document.createElement('button');
            btn.className = 'remove-btn';
            btn.textContent = 'Remove';
            btn.addEventListener('click', () => removeDomain(domain));

            li.appendChild(name);
            li.appendChild(btn);
            domainList.appendChild(li);
        });
    }
});
