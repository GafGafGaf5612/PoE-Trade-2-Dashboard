document.addEventListener('DOMContentLoaded', () => {
    // Main item analysis listeners
    document.getElementById('btnCalc').addEventListener('click', () => handleAnalysis(false));
    document.getElementById('btnRefresh').addEventListener('click', () => handleAnalysis(true));
    // Sales history listener
    document.getElementById('btnCheckSales').addEventListener('click', handleSalesAnalysis);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) {
    const logsDiv = document.getElementById('logs');
    logsDiv.innerHTML += `<div>> ${msg}</div>`;
    logsDiv.scrollTop = logsDiv.scrollHeight;
    console.log(`LOG: ${msg}`); // Also log to the dev console for visibility
}

// === CONFIG ===
const TYPE_NAMES = { /* ... (no changes) ... */ };
const HUMAN_NAMES_MAP = { /* ... (no changes) ... */ };
const CACHE_DURATION_MS = 3 * 60 * 1000;
const SALES_CACHE_DURATION_MS = 5 * 60 * 1000;

// === STATE ===
let GLOBAL_CACHE = { data: null, timestamp: 0, params: '' };
let GLOBAL_RATES = {};
let GLOBAL_HISTORY_CACHE = { data: null, timestamp: 0, league: '' };

// =================================================================================
// === SECTION 1: SALES HISTORY ANALYSIS (WITH EXTRA LOGGING)
// =================================================================================

async function handleSalesAnalysis() {
    log('--- Sales analysis started ---'); // <-- ADDED LOG
    const league = document.getElementById('league').value.trim();
    const btn = document.getElementById('btnCheckSales');
    const statusDiv = document.getElementById('salesStatusInfo');
    
    btn.disabled = true;
    statusDiv.style.color = '#e67e22';

    try {
        if (Object.keys(GLOBAL_RATES).length === 0) {
            log('Rates not found, fetching poe.ninja rates...');
            await fetchRates(league);
            renderRatesSidebar();
            log('Rates loaded.');
        }

        const now = Date.now();
        const isCacheValid = GLOBAL_HISTORY_CACHE.data && 
                             (now - GLOBAL_HISTORY_CACHE.timestamp < SALES_CACHE_DURATION_MS) &&
                             (GLOBAL_HISTORY_CACHE.league === league);

        let salesData;
        if (isCacheValid) {
            log('Using cached sales history.');
            salesData = GLOBAL_HISTORY_CACHE.data;
        } else {
            statusDiv.innerHTML = 'Fetching sales...';
            log('Fetching new sales history from API...');
            salesData = await fetchSalesHistory(league, btn);
            log(`Found ${salesData.length} sales entries.`);
            
            GLOBAL_HISTORY_CACHE = { data: salesData, timestamp: Date.now(), league: league };
            log('Sales history cached.');
        }

        log('Rendering sales dashboard...');
        renderSalesDashboard(salesData);
        log('Sales dashboard rendered.');
        const secondsAgo = Math.round((Date.now() - GLOBAL_HISTORY_CACHE.timestamp) / 1000);
        statusDiv.innerHTML = `Sales Cache (${secondsAgo}s ago)`;
        statusDiv.style.color = '#2ecc71';

    } catch (err) {
        // Log to both console and the UI log
        console.error("Error during sales analysis:", err);
        log(`SALES ERROR: ${err.message}`); 
        statusDiv.innerHTML = `Error!`;
        statusDiv.style.color = '#e74c3c';
    } finally {
        log('Sales analysis finished.'); // <-- ADDED LOG
        if (btn.dataset.timer !== "active") {
            btn.disabled = false;
        }
    }
}

async function fetchSalesHistory(league, btnElement) {
    log('Checking for POESESSID cookie...');
    const cookie = await getCookie("https://www.pathofexile.com", "POESESSID");
    if (!cookie) {
        // This is a critical failure point.
        throw new Error("Not logged in on pathofexile.com (POESESSID cookie missing). Please log in on the website and reload the extension.");
    }
    log('POESESSID cookie found. Fetching from API...');
    
    const url = `https://www.pathofexile.com/api/trade2/history/${encodeURIComponent(league)}`;
    const response = await fetch(url, { headers: { "Content-Type": "application/json" } });
    
    log(`API response status: ${response.status}`); // <-- ADDED LOG

    if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || '60';
        startCooldownTimer(btnElement, parseInt(retryAfter, 10));
        throw new Error(`Rate limited. Wait ${retryAfter} sec.`);
    }
    if (response.status === 403) throw new Error("Access Denied (403). Your POESESSID might be invalid or expired. Try re-logging on pathofexile.com.");
    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const data = await response.json();
    return data.result || [];
}

// ... the rest of your dashboard.js file remains the same ...

// (renderSalesDashboard, handleAnalysis, fetchRates, fetchItems, renderDashboard, renderStashHeatmap, renderRatesSidebar, getChaosValue, getPriceHtml, getCookie, startCooldownTimer, timeSince)
// ... copy the rest of the functions from the previous response here ...
// PASTE ALL OTHER FUNCTIONS HERE
// --- UPDATED RENDER SALES DASHBOARD ---
function renderSalesDashboard(entries) {
    const section = document.getElementById('salesHistorySection');
    const summaryCard = document.getElementById('salesSummaryCard');
    const listContainer = document.getElementById('salesList');

    section.style.display = 'block';

    if (entries.length === 0) {
        summaryCard.innerHTML = "No recent sales found in history.";
        listContainer.innerHTML = "";
        return;
    }

    // --- STEP 1: Calculate stats using the FULL list of entries ---
    let totalChaosIncome = 0;
    entries.forEach(entry => {
        totalChaosIncome += getChaosValue(entry.price.amount, entry.price.currency);
    });
    
    const newestSaleTime = new Date(entries[0].time);
    const oldestSaleTime = new Date(entries[entries.length - 1].time);
    const timeDiffMs = newestSaleTime - oldestSaleTime;
    const hoursElapsed = Math.max(timeDiffMs / (1000 * 60 * 60), 1 / 60);
    const chaosPerHour = totalChaosIncome / hoursElapsed;

    const summaryHtml = `
    <div class="sales-summary-grid">
        <div class="summary-item">
            <div class="summary-value">${entries.length}</div>
            <div class="summary-label">Total Trades</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${Math.round(totalChaosIncome)} c</div>
            <div class="summary-label">Total Income</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${chaosPerHour.toFixed(1)}</div>
            <div class="summary-label">Chaos / Hour</div>
        </div>
    </div>`;

    // --- STEP 2: Create the visual list using ONLY the last 5 sales ---
    const limitedEntries = entries.slice(0, 5);
    let listHtml = '';

    limitedEntries.forEach(entry => {
        const item = entry.item || {};
        const priceHtml = getPriceHtml(entry.price.amount, entry.price.currency);
        const saleDate = new Date(entry.time);

        listHtml += `
        <div class="sale-row">
            <img src="${item.icon}" class="item-icon">
            <div>
                <div class="stale-main-name">${item.name || ''} ${item.typeLine || ''}</div>
                <div class="sale-buyer">to <span class="sale-buyer-name">${entry.buyer}</span></div>
            </div>
            <div class="sale-price">${priceHtml}</div>
            <div class="sale-time" title="${saleDate.toLocaleString()}">${timeSince(saleDate)} ago</div>
        </div>`;
    });

    // --- STEP 3: Render both to the page ---
    summaryCard.innerHTML = summaryHtml;
    listContainer.innerHTML = listHtml;
}


// =================================================================================
// === SECTION 2: LISTED ITEMS & STASH ANALYSIS
// =================================================================================

async function handleAnalysis(forceRefresh = false) {
    const account = document.getElementById('account').value.trim();
    const league = document.getElementById('league').value.trim();
    const realm = document.getElementById('realm').value;
    const hrsThreshold = parseInt(document.getElementById('hrsThreshold').value) || 12;
    
    const statusDiv = document.getElementById('statusInfo');
    const resultsArea = document.getElementById('resultsArea');
    const btnCalc = document.getElementById('btnCalc');
    const btnRefresh = document.getElementById('btnRefresh');
    
    const currentParamsKey = `${account}|${league}|${realm}`;
    const now = Date.now();
    const isCacheValid = GLOBAL_CACHE.data && 
                         (now - GLOBAL_CACHE.timestamp < CACHE_DURATION_MS) && 
                         (GLOBAL_CACHE.params === currentParamsKey);

    btnCalc.disabled = true;
    btnRefresh.disabled = true;

    try {
        if (Object.keys(GLOBAL_RATES).length === 0 || forceRefresh) {
            log('Fetching poe.ninja rates...');
            await fetchRates(league);
        }
        renderRatesSidebar();

        if (forceRefresh || !isCacheValid) {
            resultsArea.innerHTML = '<div style="text-align:center; margin-top:50px; color:#888;">Fetching items from PoE Trade...</div>';
            document.getElementById('logs').innerHTML = ''; 
            statusDiv.innerHTML = 'Downloading Items...';
            statusDiv.style.color = '#e67e22';
            
            const items = await fetchItems(account, league, realm);
            
            GLOBAL_CACHE = { data: items, timestamp: Date.now(), params: currentParamsKey };
            log('Items cached.');
        } else {
            log('Using cached items.');
        }

        const secondsAgo = Math.round((Date.now() - GLOBAL_CACHE.timestamp) / 1000);
        statusDiv.innerHTML = `Cache (${secondsAgo}s ago)`;
        statusDiv.style.color = '#2ecc71';

        renderDashboard(GLOBAL_CACHE.data, hrsThreshold, resultsArea);

    } catch (err) {
        console.error(err);
        log(`ERROR: ${err.message}`);
        resultsArea.innerHTML = `<h2 style="color:red">Error: ${err.message}</h2>`;
    } finally {
        btnCalc.disabled = false;
        btnRefresh.disabled = false;
    }
}

async function fetchRates(league) {
    try {
        const url = `https://poe.ninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Ninja Error: ${resp.status}`);
        const data = await resp.json();
        GLOBAL_RATES = {};

        const chaosLine = data.lines.find(l => l.id === 'chaos');
        const chaosPrimaryVal = chaosLine ? chaosLine.primaryValue : 1;

        data.lines.forEach(line => {
            const id = line.id;
            const valInDivines = line.primaryValue;
            if (valInDivines) {
                const chaosEq = valInDivines / chaosPrimaryVal;
                GLOBAL_RATES[id] = chaosEq;
                if (id === 'gcp') GLOBAL_RATES['gemcutter'] = chaosEq;
                if (id === 'transmute') GLOBAL_RATES['transmutation'] = chaosEq;
            }
        });

        GLOBAL_RATES['chaos'] = 1;
        log(`Rates loaded for ${Object.keys(GLOBAL_RATES).length} items.`);
    } catch (e) {
        console.error(e);
        log(`Rates failed: ${e.message}`);
        GLOBAL_RATES = { 'chaos': 1, 'exalted': 10, 'divine': 100, 'mirror': 10000 };
    }
}

async function fetchItems(account, league, realm) {
    log('Searching items...');
    const searchUrl = `https://pathofexile.com/api/trade2/search/${realm}/${encodeURIComponent(league)}`;
    const searchPayload = {
        "query": {
            "status": { "option": "any" },
            "stats": [{ "type": "and", "filters": [] }],
            "filters": { "trade_filters": { "filters": { "account": { "input": account } } } }
        },
        "sort": { "price": "asc" }
    };
    
    const searchResp = await fetch(searchUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(searchPayload) });
    if (!searchResp.ok) throw new Error(`Trade API Error: ${searchResp.status}`);
    const searchData = await searchResp.json();
    
    if (!searchData.total) return [];
    
    const queryId = searchData.id;
    const allIds = searchData.result;
    let allItems = [];
    
    const chunkSize = 10;
    for (let i = 0; i < allIds.length; i += chunkSize) {
        const chunk = allIds.slice(i, i + chunkSize);
        const fetchUrl = `https://pathofexile.com/api/trade2/fetch/${chunk.join(',')}?query=${queryId}&realm=${realm}`;
        log(`Chunk ${Math.ceil((i + 1) / chunkSize)} / ${Math.ceil(searchData.total / chunkSize)}`);
        
        const fetchResp = await fetch(fetchUrl);
        if (fetchResp.status === 429) {
            const wait = parseInt(fetchResp.headers.get('Retry-After') || '5', 10);
            log(`Rate Limit. Waiting ${wait}s...`);
            await sleep(wait * 1000);
            i -= chunkSize; continue;
        }
        const fetchData = await fetchResp.json();
        allItems = allItems.concat(fetchData.result);
        await sleep(650);
    }
    return allItems;
}

function renderDashboard(items, hrsThreshold, container) {
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="card"><h3>No items found.</h3></div>';
        return;
    }

    const currencyGroups = {}; 
    const staleGroups = {};
    const stashTabs = {};
    const divineChaosValue = GLOBAL_RATES['divine'] || 200;

    items.forEach(item => {
        const listing = item.listing;
        let type = 'unpriced';
        let priceAmount = 0;
        let priceCurrency = null;

        if (listing && listing.price && listing.price.amount) {
            type = listing.price.type || 'unknown'; 
            priceAmount = listing.price.amount;
            priceCurrency = listing.price.currency;
        }
        
        const chaosVal = getChaosValue(priceAmount, priceCurrency);
        const indexedDate = listing.indexed ? new Date(listing.indexed) : new Date();
        const diffTime = Math.abs(new Date() - indexedDate);
        const hrsOld = Math.ceil(diffTime / (1000 * 60 * 60));

        if (priceCurrency) {
            if (!currencyGroups[type]) currencyGroups[type] = { _count: 0, _totalChaos: 0 };
            if (!currencyGroups[type][priceCurrency]) currencyGroups[type][priceCurrency] = 0;
            currencyGroups[type][priceCurrency] += priceAmount;
            currencyGroups[type]._count++;
            currencyGroups[type]._totalChaos += chaosVal;
        }

        if (hrsOld >= hrsThreshold) {
            if (!staleGroups[type]) staleGroups[type] = [];
            const stashInfo = listing.stash || {};
            const locX = (stashInfo.x !== undefined) ? stashInfo.x + 1 : "?";
            const locY = (stashInfo.y !== undefined) ? stashInfo.y + 1 : "?";
            
            staleGroups[type].push({
                rawName: item.item.name, rawType: item.item.typeLine, priceAmount, priceCurrency,
                chaosValue: chaosVal, hrs: hrsOld, icon: item.item.icon,
                tabName: stashInfo.name || "Unknown", coords: `${locX}, ${locY}`
            });
        }
        
        const stashInfo = listing.stash || {};
        if (stashInfo.name) {
            if (!stashTabs[stashInfo.name]) {
                const tabType = item.item.inventoryId || 'StashInventory'; 
                stashTabs[stashInfo.name] = { items: [], type: tabType };
            }
            stashTabs[stashInfo.name].items.push({
                x: stashInfo.x, y: stashInfo.y, w: item.item.w, h: item.item.h,
                chaosValue: chaosVal, hrsOld, icon: item.item.icon,
                name: (item.item.name || item.item.typeLine), price: `${priceAmount} ${priceCurrency}`
            });
        }
    });
    
    let finalHtml = '';

    // RENDER STALE ITEMS
    const hasStale = Object.keys(staleGroups).length > 0;
    if (hasStale) {
        finalHtml += `<div class="section-title text-danger">⚠️ Stale Items (> ${hrsThreshold} hrs)</div>`;
        for (const [type, staleList] of Object.entries(staleGroups)) {
            staleList.sort((a, b) => b.chaosValue - a.chaosValue || b.hrs - a.hrs);
            let rowsHtml = '';
            staleList.forEach(item => { /* ... build stale row html ... */ 
                const colorClass = item.hrs >= 48 ? 'danger' : 'warn';
                const ageColor = item.hrs >= 48 ? 'text-danger' : 'text-warn';
                const priceHtml = getPriceHtml(item.priceAmount, item.priceCurrency);
                let mainText = item.rawName && item.rawName.length > 0 ? item.rawName : item.rawType;
                let subText = item.rawName && item.rawName.length > 0 ? item.rawType : "";
                const subTextHtml = subText ? `<div class="stale-sub-name">${subText}</div>` : '';
                rowsHtml += `
                <div class="stale-row ${colorClass}">
                    <img src="${item.icon}" class="item-icon">
                    <div class="item-text-group"><div class="stale-main-name" title="${mainText}">${mainText}</div>${subTextHtml}</div>
                    <div class="stale-loc"><span>Tab: <span class="loc-highlight">${item.tabName}</span></span><span>Pos: <span class="loc-highlight">${item.coords}</span></span></div>
                    <div class="stale-type">${TYPE_NAMES[type] || type}</div>
                    <div class="stale-price">${priceHtml}</div>
                    <div class="stale-age ${ageColor}">${item.hrs}h</div>
                </div>`;
            });
            finalHtml += `<div class="card" style="border-left: 3px solid #e74c3c;"><div class="card-header"><div class="card-title text-danger">${TYPE_NAMES[type] || type}</div><div class="card-count">${staleList.length} items</div></div><div class="stale-list">${rowsHtml}</div></div>`;
        }
    } else {
         finalHtml += `<div class="card"><h3 style="color:#2ecc71; margin:0;">✅ All items are fresh (< ${hrsThreshold} hrs)</h3></div>`;
    }

    // RENDER REVENUE
    finalHtml += `<div class="section-title" style="margin-top: 30px; border-color: #2ecc71;">💰 Expected Revenue</div>`;
    const currGroupKeys = Object.keys(currencyGroups);
    if (currGroupKeys.length > 0) {
        currGroupKeys.sort((a, b) => currencyGroups[b]._totalChaos - currencyGroups[a]._totalChaos);
        currGroupKeys.forEach(type => {
            const group = currencyGroups[type];
            const { _count: count, _totalChaos: totalChaos, ...currencies } = group;
            let currItemsHtml = '';
            Object.keys(currencies).sort((a, b) => getChaosValue(currencies[b], b) - getChaosValue(currencies[a], a))
                .forEach(c => {
                    const val = Math.round(currencies[c] * 100) / 100;
                    const cName = c.charAt(0).toUpperCase() + c.slice(1);
                    let valClass = 'curr-val';
                    const cValChaos = getChaosValue(1, c);
                    if (cValChaos >= 100) valClass = 'price-tier-s'; else if (cValChaos >= 15) valClass = 'price-tier-a';
                    currItemsHtml += `<div class="currency-item"><span>${cName}</span><span class="${valClass}">${val}</span></div>`;
                });
            finalHtml += `<div class="card"><div class="card-header"><div class="card-title" style="color: #dcb164;">${TYPE_NAMES[type] || type} <span style="font-size:12px; color:#666; margin-left:10px; font-weight:normal;">(≈ ${Math.round(totalChaos)} c)</span></div><div class="card-count">${count} items</div></div><div class="currency-grid">${currItemsHtml}</div></div>`;
        });
    } else {
        finalHtml += `<div class="card" style="color:#666;">No priced items.</div>`;
    }

    container.innerHTML = finalHtml;
    
    renderStashHeatmap(stashTabs, hrsThreshold, divineChaosValue);
}

function renderStashHeatmap(stashTabs, hrsThreshold, divineChaosValue) {
    const section = document.getElementById('heatmapSection');
    const navContainer = document.getElementById('heatmapTabsNav');
    const contentContainer = document.getElementById('heatmapContent');
    
    navContainer.innerHTML = ''; contentContainer.innerHTML = '';
    if (Object.keys(stashTabs).length === 0) {
        section.style.display = 'none'; return;
    }

    let navHtml = ''; let contentHtml = '';
    const sortedTabNames = Object.keys(stashTabs).sort(); 

    for (const tabName of sortedTabNames) {
        const tab = stashTabs[tabName];
        const isQuad = (tab.type || '').toLowerCase().includes('quad');
        const gridClass = isQuad ? 'stash-grid quad' : 'stash-grid normal';
        navHtml += `<button class="heatmap-tab-link" data-tab-name="${encodeURIComponent(tabName)}">${tabName}</button>`;
        let itemsHtml = '';
        tab.items.forEach(item => {
            let itemClass = 'heatmap-item';
            if (item.hrsOld >= hrsThreshold) itemClass += ' stale';
            else if (item.chaosValue > 0) {
                if (item.chaosValue >= divineChaosValue * 5) itemClass += ' valuable-4';
                else if (item.chaosValue >= divineChaosValue) itemClass += ' valuable-3';
                else if (item.chaosValue >= 50) itemClass += ' valuable-2';
                else if (item.chaosValue >= 10) itemClass += ' valuable-1';
            }
            const pos = `grid-column: ${item.x + 1}/span ${item.w}; grid-row: ${item.y + 1}/span ${item.h};`;
            const tip = `${item.name}\nPrice: ${item.price}\nChaos: ~${Math.round(item.chaosValue)}\nAge: ${item.hrsOld}h`;
            itemsHtml += `<div class="${itemClass}" style="${pos} background-image: url(${item.icon});" title="${tip}"></div>`;
        });
        contentHtml += `<div class="stash-grid-wrapper" data-tab-content="${encodeURIComponent(tabName)}"><div class="${gridClass}">${itemsHtml}</div></div>`;
    }

    navContainer.innerHTML = navHtml;
    contentContainer.innerHTML = contentHtml;

    const firstTabLink = navContainer.querySelector('.heatmap-tab-link');
    const firstTabContent = contentContainer.querySelector('.stash-grid-wrapper');
    if (firstTabLink && firstTabContent) {
        firstTabLink.classList.add('active');
        firstTabContent.classList.add('active');
    }

    navContainer.addEventListener('click', (event) => {
        const clickedTab = event.target.closest('.heatmap-tab-link');
        if (!clickedTab) return;
        const targetTabName = clickedTab.dataset.tabName;
        if (!targetTabName) return;
        navContainer.querySelectorAll('.heatmap-tab-link').forEach(link => link.classList.toggle('active', link.dataset.tabName === targetTabName));
        contentContainer.querySelectorAll('.stash-grid-wrapper').forEach(content => content.classList.toggle('active', content.dataset.tabContent === targetTabName));
    });

    section.style.display = 'block';
}


// =================================================================================
// === SECTION 3: UTILITY & HELPER FUNCTIONS
// =================================================================================

function renderRatesSidebar() {
    const container = document.getElementById('ratesPanel');
    const list = document.getElementById('ratesListContent');
    container.style.display = 'block';
    const sortedRates = Object.entries(GLOBAL_RATES).sort((a, b) => b[1] - a[1]);
    let html = '';
    sortedRates.forEach(([id, val]) => {
        if (val < 0.1) return;
        let displayName = HUMAN_NAMES_MAP[id] || (id.charAt(0).toUpperCase() + id.slice(1));
        const valClass = val >= 100 ? 'rate-val expensive' : 'rate-val';
        html += `<div class="rate-row"><span class="rate-name">${displayName}</span><span class="${valClass}">${Math.round(val * 100) / 100}</span></div>`;
    });
    list.innerHTML = html;
}

function getChaosValue(amount, currencyId) {
    if (!amount || !currencyId) return 0;
    const id = currencyId.toLowerCase();
    const rate = GLOBAL_RATES[id] || 0;
    return amount * rate;
}

function getPriceHtml(amount, currency) {
    if (!amount || !currency) return '<span class="price-tier-c">No Price</span>';
    const chaosVal = getChaosValue(amount, currency);
    let tierClass = 'price-tier-c';
    if (chaosVal >= 100 || currency.toLowerCase().includes('divine') || currency.toLowerCase().includes('mirror')) tierClass = 'price-tier-s';
    else if (chaosVal >= 15 || currency.toLowerCase().includes('exalted')) tierClass = 'price-tier-a';
    else if (chaosVal >= 4) tierClass = 'price-tier-b';
    return `<span class="${tierClass}">${amount} ${currency}</span>`;
}

function getCookie(url, name) { 
    return new Promise((resolve, reject) => {
        if (typeof chrome.cookies === 'undefined') {
            return reject(new Error("Cookie permissions are missing in manifest.json."));
        }
        chrome.cookies.get({ url: url, name: name }, (cookie) => {
            resolve(cookie ? cookie.value : null);
        });
    });
}

function startCooldownTimer(btn, seconds) {
    btn.dataset.timer = "active";
    btn.disabled = true;
    let left = seconds;
    btn.innerText = `LOCKED (${left}s)`;
    const interval = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(interval);
            btn.dataset.timer = "";
            btn.disabled = false;
            btn.innerText = "CHECK RECENT SALES";
        } else {
            btn.innerText = `LOCKED (${left}s)`;
        }
    }, 1000);
}

function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m";
    return Math.floor(seconds) + "s";
}
