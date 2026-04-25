const fs = require('fs');

const v3Path = 'c:/projects/rajasthani/qr/customer/rajasthani_customer_v3.html';
const v4Path = 'c:/projects/rajasthani/qr/customer/public/customer.html';

const v3Content = fs.readFileSync(v3Path, 'utf8');
let v4Content = fs.readFileSync(v4Path, 'utf8');

// Extract MENU
const menuMatch = v3Content.match(/var MENU = \[([\s\S]*?)\];/);
if (menuMatch) {
    const fullMenu = `const MENU = [${menuMatch[1]}];`;
    v4Content = v4Content.replace(
        /const MENU = \[[\s\S]*?\]; \/\/ Trimmed down for this code file but uses same logic/,
        fullMenu + `\n    let CATS = [];\n    MENU.forEach(m => { if(!CATS.includes(m.cat)) CATS.push(m.cat); });\n    let selectedCats = [];\n    let tempFilter = [];`
    );
}

// Add Filter HTML
v4Content = v4Content.replace(
    /<div class="search-row">\s*<input class="search-bar" [^>]+>\s*<\/div>/,
    `<div class="search-row">
            <input class="search-bar" type="text" placeholder="🔍  Search dishes..." id="search-inp" oninput="onSearch(this.value)" />
            <button class="filter-btn" id="filter-btn" onclick="openFilter()">☰ Filter</button>
        </div>`
);

// Add Filter Modal
v4Content = v4Content.replace(
    /<!-- Modals -->/,
    `<!-- Modals -->
<div class="modal-overlay" id="filter-modal" onclick="if(event.target===this) this.classList.remove('open')">
    <div class="modal-sheet"><div class="sheet-handle"></div><div id="filter-inner"></div></div>
</div>`
);

// Update renderMenu to support selectedCats
v4Content = v4Content.replace(
    /MENU\.forEach\(m => \{/,
    `MENU.forEach(m => {\n            if (selectedCats.length > 0 && !selectedCats.includes(m.cat)) return;`
);

// Inject Filter JS functions
const filterJs = `
    function openFilter() {
        tempFilter = [...selectedCats];
        renderFilter();
        document.getElementById('filter-modal').classList.add('open');
    }

    function renderFilter() {
        document.getElementById('filter-inner').innerHTML = \`
            <div class="sheet-title">Filter by Cuisine</div>
            <div class="filter-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0;">
                \${CATS.map(c => \`<div class="fc \${tempFilter.includes(c)?'sel':''}" style="border:1px solid #e8e4df;border-radius:8px;padding:10px;font-size:12px;cursor:pointer;\${tempFilter.includes(c)?'border-color:#c8392b;background:#fff5f4;color:#c8392b':''}" onclick="toggleF('\${c.replace(/'/g,"\\\\'")}')">\${c}</div>\`).join('')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <button class="back-btn" style="margin:0" onclick="clearF()">Clear All</button>
                <button class="place-btn" style="margin:0" onclick="applyF()">Apply</button>
            </div>\`;
    }

    function toggleF(c) {
        if(tempFilter.includes(c)) tempFilter = tempFilter.filter(x=>x!==c);
        else tempFilter.push(c);
        renderFilter();
    }
    function clearF() { tempFilter = []; renderFilter(); }
    function applyF() {
        selectedCats = [...tempFilter];
        document.getElementById('filter-modal').classList.remove('open');
        renderActiveFilters();
        renderMenu();
    }
    function renderActiveFilters() {
        const row = document.getElementById('active-filters');
        if(!selectedCats.length) { row.innerHTML=''; return; }
        row.innerHTML = selectedCats.map(c => \`<div class="af-chip" onclick="removeF('\${c.replace(/'/g,"\\\\'")}')">\${c} ✕</div>\`).join('');
    }
    function removeF(c) { selectedCats = selectedCats.filter(x=>x!==c); renderActiveFilters(); renderMenu(); }

`;

v4Content = v4Content.replace(
    /function onSearch\(v\) \{ searchQ = v; renderMenu\(\); \}/,
    `function onSearch(v) { searchQ = v; renderMenu(); }\n` + filterJs
);

fs.writeFileSync(v4Path, v4Content, 'utf8');
console.log('Customer app patched successfully.');
