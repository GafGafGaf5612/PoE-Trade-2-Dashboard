document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnCalc').addEventListener('click', () => handleAnalysis(false));
    document.getElementById('btnRefresh').addEventListener('click', () => handleAnalysis(true));
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) {
    const logsDiv = document.getElementById('logs');
    logsDiv.innerHTML += `<div>> ${msg}</div>`;
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

// === CONFIG ===
const TYPE_NAMES = {
    'instant': '⚡ NPC / Exchange',
    '~b/o': '🤝 Instant Trade',
    '~price': '🏷️ Fixed Price',
    'unpriced': '❓ Offers'
};

// Словарь для отображения красивых имен в сайдбаре
const HUMAN_NAMES_MAP = {
    'exalted': 'Exalted Orb',
    'divine': 'Divine Orb',
    'mirror': 'Mirror of Kalandra',
    'chaos': 'Chaos Orb',
    'alch': 'Orb of Alchemy',
    'chance': 'Orb of Chance',
    'gcp': 'Gemcutter\'s Prism',
    'gemcutter': 'Gemcutter\'s Prism',
    'vaal': 'Vaal Orb',
    'regal': 'Regal Orb',
    'transmute': 'Orb of Transmutation',
    'aug': 'Orb of Augmentation',
    'alt': 'Orb of Alteration',
    'annul': 'Orb of Annulment',
    'scouring': 'Orb of Scouring',
    'regret': 'Orb of Regret',
    'wisdom': 'Scroll of Wisdom',
    'bauble': 'Glassblower\'s Bauble',
    'whetstone': 'Blacksmith\'s Whetstone',
    'scrap': 'Armourer\'s Scrap'
};

const CACHE_DURATION_MS = 3 * 60 * 1000; // 3 min

// === STATE ===
let GLOBAL_CACHE = { data: null, timestamp: 0, params: '' };
let GLOBAL_RATES = {}; 

// === MAIN HANDLER ===
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

    // Disable UI
    btnCalc.disabled = true;
    btnRefresh.disabled = true;

    try {
        // 1. Get/Refresh Rates (Fast)
        // Грузим курсы, если их нет или нажали Refresh
        if (Object.keys(GLOBAL_RATES).length === 0 || forceRefresh) {
            log('Fetching poe.ninja rates...');
            await fetchRates(league);
        }
        renderRatesSidebar();

        // 2. Get/Refresh Items (Slow)
        if (forceRefresh || !isCacheValid) {
            resultsArea.innerHTML = '<div style="text-align:center; margin-top:50px; color:#888;">Fetching items from PoE Trade...</div>';
            document.getElementById('logs').innerHTML = ''; 
            
            statusDiv.innerHTML = 'Downloading Items...';
            statusDiv.style.color = '#e67e22';
            
            const items = await fetchItems(account, league, realm);
            
            GLOBAL_CACHE = {
                data: items,
                timestamp: Date.now(),
                params: currentParamsKey
            };
            log('Items cached.');
        } else {
            log('Using cached items.');
        }

        const secondsAgo = Math.round((Date.now() - GLOBAL_CACHE.timestamp) / 1000);
        statusDiv.innerHTML = `Cache (${secondsAgo}s ago)`;
        statusDiv.style.color = '#2ecc71';

        // 3. Render Dashboard
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

// === API: POE.NINJA (UPDATED FOR POE 2 JSON) ===
async function fetchRates(league) {
    try {
        // Используем URL для PoE 2 Exchange Currency
        const url = `https://poe.ninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
        
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Ninja Error: ${resp.status}`);
        
        const data = await resp.json();
        
        GLOBAL_RATES = {};

        // 1. Находим "вес" Хаоса в Дивайнах (primaryValue), чтобы все пересчитать в Хаосы
        // В PoE 2 Ninja primaryValue обычно в Дивайнах.
        const chaosLine = data.lines.find(l => l.id === 'chaos');
        const chaosPrimaryVal = chaosLine ? chaosLine.primaryValue : 1;

        // 2. Парсим все линии
        data.lines.forEach(line => {
            const id = line.id; // напр. "exalted", "gcp", "divine"
            const valInDivines = line.primaryValue; // Цена в дивайнах

            if (valInDivines) {
                // Конвертируем в Chaos Equivalent
                // Формула: (Цена_Предмета_в_Див) / (Цена_Хаоса_в_Див)
                const chaosEq = valInDivines / chaosPrimaryVal;
                
                GLOBAL_RATES[id] = chaosEq;

                // 3. Исправляем несовпадения имен (Trade API vs Ninja API)
                if (id === 'gcp') GLOBAL_RATES['gemcutter'] = chaosEq;
                if (id === 'transmute') GLOBAL_RATES['transmutation'] = chaosEq;
            }
        });

        // Гарантируем, что хаос = 1
        GLOBAL_RATES['chaos'] = 1;

        log(`Rates loaded for ${Object.keys(GLOBAL_RATES).length} items.`);

    } catch (e) {
        console.error(e);
        log(`Rates failed: ${e.message}`);
        // Fallback значения на случай ошибки
        GLOBAL_RATES = { 'chaos': 1, 'exalted': 10, 'divine': 100, 'mirror': 10000 };
    }
}

function renderRatesSidebar() {
    const container = document.getElementById('ratesPanel');
    const list = document.getElementById('ratesListContent');
    container.style.display = 'block';

    const sortedRates = Object.entries(GLOBAL_RATES).sort((a, b) => b[1] - a[1]);
    let html = '';
    
    sortedRates.forEach(([id, val]) => {
        if (val < 0.1) return; // Скрываем дешевый мусор

        // Пытаемся найти красивое имя, иначе делаем Capitalize
        let displayName = HUMAN_NAMES_MAP[id] || (id.charAt(0).toUpperCase() + id.slice(1));

        const valClass = val >= 100 ? 'rate-val expensive' : 'rate-val';
        
        html += `
        <div class="rate-row">
            <span class="rate-name">${displayName}</span>
            <span class="${valClass}">${Math.round(val * 100) / 100}</span>
        </div>`;
    });
    list.innerHTML = html;
}

// === API: POE TRADE ===
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

// === HELPER: VISUALS ===
function getChaosValue(amount, currencyId) {
    if (!amount || !currencyId) return 0;
    // Приводим к нижнему регистру, так как Ninja отдает 'exalted', а Trade иногда 'Exalted'
    const id = currencyId.toLowerCase();
    const rate = GLOBAL_RATES[id] || 0;
    return amount * rate;
}

function getPriceHtml(amount, currency) {
    if (!amount || !currency) return '<span class="price-tier-c">No Price</span>';
    const chaosVal = getChaosValue(amount, currency);
    let tierClass = 'price-tier-c';
    
    // Tier S: > 100c или топ валюта
    if (chaosVal >= 100 || currency.toLowerCase().includes('divine') || currency.toLowerCase().includes('mirror')) {
        tierClass = 'price-tier-s';
    } 
    // Tier A: > 15c или exalt
    else if (chaosVal >= 15 || currency.toLowerCase().includes('exalted')) {
        tierClass = 'price-tier-a';
    } 
    // Tier B: > 4c
    else if (chaosVal >= 4) {
        tierClass = 'price-tier-b';
    }
    
    return `<span class="${tierClass}">${amount} ${currency}</span>`;
}

// === RENDER DASHBOARD ===
function renderDashboard(items, hrsThreshold, container) {
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="card"><h3>No items found.</h3></div>';
        return;
    }

    const currencyGroups = {}; 
    const staleGroups = {};

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

        // Aggregate Currency
        if (priceCurrency) {
            if (!currencyGroups[type]) currencyGroups[type] = { _count: 0, _totalChaos: 0 };
            if (!currencyGroups[type][priceCurrency]) currencyGroups[type][priceCurrency] = 0;
            currencyGroups[type][priceCurrency] += priceAmount;
            currencyGroups[type]._count++;
            currencyGroups[type]._totalChaos += getChaosValue(priceAmount, priceCurrency);
        }

        // Check Stale
        if (listing && listing.indexed) {
            const indexedDate = new Date(listing.indexed);
            const diffTime = Math.abs(new Date() - indexedDate);
            const hrsOld = Math.ceil(diffTime / (1000 * 60 * 60)); 
            
            if (hrsOld >= hrsThreshold) {
                if (!staleGroups[type]) staleGroups[type] = [];
                const stashInfo = listing.stash || {};
                const locX = (stashInfo.x !== undefined) ? stashInfo.x + 1 : "?";
                const locY = (stashInfo.y !== undefined) ? stashInfo.y + 1 : "?";
                const chaosVal = getChaosValue(priceAmount, priceCurrency);

                staleGroups[type].push({
                    rawName: item.item.name,
                    rawType: item.item.typeLine,
                    priceAmount: priceAmount,
                    priceCurrency: priceCurrency,
                    chaosValue: chaosVal,
                    hrs: hrsOld,
                    icon: item.item.icon,
                    tabName: stashInfo.name || "Unknown",
                    coords: `${locX}, ${locY}`
                });
            }
        }
    });

    let finalHtml = '';

    // --- RENDER STALE ---
    const hasStale = Object.keys(staleGroups).length > 0;
    if (hasStale) {
        finalHtml += `<div class="section-title text-danger">⚠️ Stale Items (> ${hrsThreshold} hrs)</div>`;
        for (const [type, staleList] of Object.entries(staleGroups)) {
            // Sort by Value DESC, then Age DESC
            staleList.sort((a, b) => {
                if (b.chaosValue !== a.chaosValue) return b.chaosValue - a.chaosValue;
                return b.hrs - a.hrs;
            });

            let rowsHtml = '';
            staleList.forEach(item => {
                const colorClass = item.hrs >= 48 ? 'danger' : 'warn';
                const ageColor = item.hrs >= 48 ? 'text-danger' : 'text-warn';
                const priceHtml = getPriceHtml(item.priceAmount, item.priceCurrency);
                let mainText = item.rawName && item.rawName.length > 0 ? item.rawName : item.rawType;
                let subText = item.rawName && item.rawName.length > 0 ? item.rawType : "";
                const subTextHtml = subText ? `<div class="stale-sub-name">${subText}</div>` : '';

                rowsHtml += `
                <div class="stale-row ${colorClass}">
                    <img src="${item.icon}" class="item-icon">
                    <div class="item-text-group">
                        <div class="stale-main-name" title="${mainText}">${mainText}</div>
                        ${subTextHtml}
                    </div>
                    <div class="stale-loc">
                        <span>Tab: <span class="loc-highlight">${item.tabName}</span></span>
                        <span>Pos: <span class="loc-highlight">${item.coords}</span></span>
                    </div>
                    <div class="stale-type">${TYPE_NAMES[type] || type}</div>
                    <div class="stale-price">${priceHtml}</div>
                    <div class="stale-age ${ageColor}">${item.hrs}h</div>
                </div>`;
            });

            finalHtml += `
            <div class="card" style="border-left: 3px solid #e74c3c;">
                <div class="card-header">
                    <div class="card-title text-danger">${TYPE_NAMES[type] || type}</div>
                    <div class="card-count">${staleList.length} items</div>
                </div>
                <div class="stale-list">${rowsHtml}</div>
            </div>`;
        }
    } else {
         finalHtml += `<div class="card"><h3 style="color:#2ecc71; margin:0;">✅ All items are fresh (< ${hrsThreshold} hrs)</h3></div>`;
    }

    // --- RENDER REVENUE ---
    finalHtml += `<div class="section-title" style="margin-top: 30px; border-color: #2ecc71;">💰 Expected Revenue</div>`;

    const currGroupKeys = Object.keys(currencyGroups);
    if (currGroupKeys.length > 0) {
        currGroupKeys.sort((a, b) => currencyGroups[b]._totalChaos - currencyGroups[a]._totalChaos);
        currGroupKeys.forEach(type => {
            const group = currencyGroups[type];
            const count = group._count;
            const totalChaos = Math.round(group._totalChaos); 
            delete group._count; delete group._totalChaos;

            let currItemsHtml = '';
            const sortedCurrencies = Object.keys(group).sort((a, b) => {
                const valA = getChaosValue(group[a], a);
                const valB = getChaosValue(group[b], b);
                return valB - valA;
            });

            sortedCurrencies.forEach(c => {
                const val = Math.round(group[c] * 100) / 100;
                const cName = c.charAt(0).toUpperCase() + c.slice(1);
                let valClass = 'curr-val';
                const cValChaos = getChaosValue(1, c);
                if (cValChaos >= 100) valClass = 'price-tier-s';
                else if (cValChaos >= 15) valClass = 'price-tier-a';

                currItemsHtml += `
                <div class="currency-item">
                    <span>${cName}</span>
                    <span class="${valClass}">${val}</span>
                </div>`;
            });

            finalHtml += `
            <div class="card">
                <div class="card-header">
                    <div class="card-title" style="color: #dcb164;">
                        ${TYPE_NAMES[type] || type} 
                        <span style="font-size:12px; color:#666; margin-left:10px; font-weight:normal;">(≈ ${totalChaos} c)</span>
                    </div>
                    <div class="card-count">${count} items</div>
                </div>
                <div class="currency-grid">${currItemsHtml}</div>
            </div>`;
        });
    } else {
        finalHtml += `<div class="card" style="color:#666;">No priced items.</div>`;
    }

    container.innerHTML = finalHtml;
}