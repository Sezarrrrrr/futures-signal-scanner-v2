'use strict';

/* =========================================================
   FUTURES SIGNAL SCANNER V2
   Binance Futures + Teknik Analiz + Paper Trading
   Gerçek emir göndermez.
========================================================= */

const BINANCE_API = 'https://fapi.binance.com';
const BINANCE_WS = 'wss://fstream.binance.com/stream?streams=!ticker@arr';

const appState = {
    currentView: 'markets',
    scanning: false,
    connected: false,
    marketCount: 0,
    longCount: 0,
    shortCount: 0,
    symbols: [],
    tickers: new Map(),
    signals: [],
    selectedSignal: null,
    ws: null,
    lastStatus: 'Sistem başlatıldı.',
    paperBalance: 1000,
    paperOpenPosition: null,
    paperHistory: [],
    paperPlanSignal: null,
    minScore: 62
};

/* =========================================================
   YARDIMCILAR
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function formatPrice(value) {
    const price = safeNumber(value, NaN);

    if (!Number.isFinite(price)) {
        return '-';
    }

    if (price >= 1000) {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    if (price >= 1) {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4
        });
    }

    if (price >= 0.01) {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 5,
            maximumFractionDigits: 5
        });
    }

    return price.toLocaleString('en-US', {
        minimumFractionDigits: 8,
        maximumFractionDigits: 8
    });
}

function formatMoney(value) {
    return safeNumber(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + ' USDT';
}

function formatVolume(value) {
    const volume = safeNumber(value);

    if (volume >= 1000000000) {
        return (volume / 1000000000).toFixed(2) + 'B';
    }

    if (volume >= 1000000) {
        return (volume / 1000000).toFixed(2) + 'M';
    }

    if (volume >= 1000) {
        return (volume / 1000).toFixed(2) + 'K';
    }

    return volume.toFixed(2);
}

function setStatus(message) {
    appState.lastStatus = message;

    const statusBox = $('statusBox');

    if (statusBox) {
        statusBox.textContent = message;
    }

    console.log('[Scanner]', message);
}

function setConnection(status, text) {
    const dot = $('connectionDot');
    const connectionText = $('connectionText');

    if (dot) {
        dot.classList.remove('online', 'offline', 'loading');

        if (status === 'online') {
            dot.classList.add('online');
        } else if (status === 'loading') {
            dot.classList.add('loading');
        } else {
            dot.classList.add('offline');
        }
    }

    if (connectionText) {
        connectionText.textContent = text;
    }

    appState.connected = status === 'online';
}

function formatTrend(trend) {
    if (trend === 'LONG') {
        return '▲ LONG';
    }

    if (trend === 'SHORT') {
        return '▼ SHORT';
    }

    if (trend === 'LONG_WEAK') {
        return '↗ Zayıf Long';
    }

    if (trend === 'SHORT_WEAK') {
        return '↘ Zayıf Short';
    }

    return '— Nötr';
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/* =========================================================
   LOCAL STORAGE
========================================================= */

function loadSavedPaperData() {
    try {
        const savedBalance = localStorage.getItem('paperBalance');
        const savedPosition = localStorage.getItem('paperOpenPosition');
        const savedHistory = localStorage.getItem('paperHistory');
        const savedMinScore = localStorage.getItem('minScore');

        if (savedBalance !== null) {
            appState.paperBalance = safeNumber(savedBalance, 1000);
        }

        if (savedPosition) {
            appState.paperOpenPosition = JSON.parse(savedPosition);
        }

        if (savedHistory) {
            appState.paperHistory = JSON.parse(savedHistory);
        }

        if (savedMinScore !== null) {
            appState.minScore = safeNumber(savedMinScore, 62);
        }
    } catch (error) {
        console.warn('Kayıtlı paper verileri okunamadı:', error);
    }

    const input = $('minScoreInput');

    if (input) {
        input.value = appState.minScore;
    }
}

function savePaperData() {
    try {
        localStorage.setItem(
            'paperBalance',
            String(appState.paperBalance)
        );

        localStorage.setItem(
            'paperOpenPosition',
            JSON.stringify(appState.paperOpenPosition)
        );

        localStorage.setItem(
            'paperHistory',
            JSON.stringify(appState.paperHistory)
        );

        localStorage.setItem(
            'minScore',
            String(appState.minScore)
        );
    } catch (error) {
        console.warn('Paper verileri kaydedilemedi:', error);
    }
}

/* =========================================================
   İSTATİSTİKLER VE GÖRÜNÜM
========================================================= */

function renderStats() {
    const marketCount = $('marketCount');
    const longCount = $('longCount');
    const shortCount = $('shortCount');

    if (marketCount) {
        marketCount.textContent = appState.marketCount;
    }

    if (longCount) {
        longCount.textContent = appState.longCount;
    }

    if (shortCount) {
        shortCount.textContent = appState.shortCount;
    }
}

function showView(viewName) {
    const views = {
        markets: $('viewMarkets'),
        trade: $('viewTrade'),
        position: $('viewPosition'),
        settings: $('viewSettings')
    };

    Object.entries(views).forEach(([name, element]) => {
        if (element) {
            element.classList.toggle('active', name === viewName);
        }
    });

    document.querySelectorAll('.nav-btn').forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.view === viewName
        );
    });

    appState.currentView = viewName;

    if (viewName === 'position') {
        renderPositionView();
        renderHistoryView();
    }

    if (viewName === 'trade') {
        renderTradeView();
    }
}

/* =========================================================
   BINANCE API
========================================================= */

async function binanceFetch(path) {
    const response = await fetch(`${BINANCE_API}${path}`);

    if (!response.ok) {
        throw new Error(`Binance API hatası: ${response.status}`);
    }

    return response.json();
}

async function loadExchangeInfo() {
    const data = await binanceFetch('/fapi/v1/exchangeInfo');

    appState.symbols = data.symbols
        .filter(item => {
            return (
                item.status === 'TRADING' &&
                item.quoteAsset === 'USDT' &&
                item.contractType === 'PERPETUAL'
            );
        })
        .map(item => item.symbol);

    appState.marketCount = appState.symbols.length;
    renderStats();
}

async function loadTickers() {
    const data = await binanceFetch('/fapi/v1/ticker/24hr');
    const validSymbols = new Set(appState.symbols);

    data.forEach(item => {
        if (!validSymbols.has(item.symbol)) {
            return;
        }

        appState.tickers.set(item.symbol, {
            symbol: item.symbol,
            lastPrice: safeNumber(item.lastPrice),
            priceChangePercent: safeNumber(item.priceChangePercent),
            quoteVolume: safeNumber(item.quoteVolume)
        });
    });
}

async function getKlines(symbol, interval, limit = 120) {
    const encodedSymbol = encodeURIComponent(symbol);

    const data = await binanceFetch(
        `/fapi/v1/klines?symbol=${encodedSymbol}&interval=${interval}&limit=${limit}`
    );

    return data.map(candle => {
        return {
            openTime: candle[0],
            open: safeNumber(candle[1]),
            high: safeNumber(candle[2]),
            low: safeNumber(candle[3]),
            close: safeNumber(candle[4]),
            volume: safeNumber(candle[5]),
            closeTime: candle[6]
        };
    });
}

/* =========================================================
   TEKNİK GÖSTERGELER
========================================================= */

function calculateEMA(values, period) {
    if (!Array.isArray(values) || values.length < period) {
        return null;
    }

    const multiplier = 2 / (period + 1);

    let ema = values
        .slice(0, period)
        .reduce((sum, value) => sum + value, 0) / period;

    for (let i = period; i < values.length; i++) {
        ema = (
            (values[i] - ema) * multiplier
        ) + ema;
    }

    return ema;
}

function calculateRSI(values, period = 14) {
    if (!Array.isArray(values) || values.length < period + 1) {
        return 50;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const difference = values[i] - values[i - 1];

        if (difference >= 0) {
            gains += difference;
        } else {
            losses += Math.abs(difference);
        }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
        const difference = values[i] - values[i - 1];

        const gain = difference > 0 ? difference : 0;
        const loss = difference < 0 ? Math.abs(difference) : 0;

        averageGain = (
            (averageGain * (period - 1)) + gain
        ) / period;

        averageLoss = (
            (averageLoss * (period - 1)) + loss
        ) / period;
    }

    if (averageLoss === 0) {
        return averageGain > 0 ? 100 : 50;
    }

    const relativeStrength = averageGain / averageLoss;

    return 100 - (100 / (1 + relativeStrength));
}

function calculateMACD(values) {
    if (!Array.isArray(values) || values.length < 35) {
        return {
            macd: 0,
            signal: 0,
            histogram: 0
        };
    }

    const macdValues = [];

    for (let i = 0; i < values.length; i++) {
        const slice = values.slice(0, i + 1);

        if (slice.length < 26) {
            continue;
        }

        const ema12 = calculateEMA(slice, 12);
        const ema26 = calculateEMA(slice, 26);

        if (ema12 !== null && ema26 !== null) {
            macdValues.push(ema12 - ema26);
        }
    }

    if (macdValues.length < 9) {
        return {
            macd: 0,
            signal: 0,
            histogram: 0
        };
    }

    const macd = macdValues[macdValues.length - 1];
    const signal = calculateEMA(macdValues, 9) || 0;

    return {
        macd,
        signal,
        histogram: macd - signal
    };
}

function calculateATR(candles, period = 14) {
    if (!Array.isArray(candles) || candles.length < period + 1) {
        return 0;
    }

    const trueRanges = [];

    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const trueRange = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );

        trueRanges.push(trueRange);
    }

    const recentRanges = trueRanges.slice(-period);

    if (!recentRanges.length) {
        return 0;
    }

    return recentRanges.reduce(
        (sum, value) => sum + value,
        0
    ) / recentRanges.length;
}

function calculateVolumeRatio(candles, period = 20) {
    if (!Array.isArray(candles) || candles.length < period + 1) {
        return 1;
    }

    const currentVolume = candles[candles.length - 1].volume;

    const previousVolumes = candles
        .slice(-(period + 1), -1)
        .map(candle => candle.volume);

    const averageVolume = previousVolumes.reduce(
        (sum, value) => sum + value,
        0
    ) / previousVolumes.length;

    if (!averageVolume) {
        return 1;
    }

    return currentVolume / averageVolume;
}

function getTrend(candles) {
    if (!Array.isArray(candles) || !candles.length) {
        return 'NEUTRAL';
    }

    const closes = candles.map(candle => candle.close);
    const lastPrice = closes[closes.length - 1];

    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema100 = calculateEMA(closes, 100);

    if (ema20 === null || ema50 === null || ema100 === null) {
        return 'NEUTRAL';
    }

    if (
        lastPrice > ema20 &&
        ema20 > ema50 &&
        ema50 > ema100
    ) {
        return 'LONG';
    }

    if (
        lastPrice < ema20 &&
        ema20 < ema50 &&
        ema50 < ema100
    ) {
        return 'SHORT';
    }

    if (lastPrice > ema20 && ema20 > ema50) {
        return 'LONG_WEAK';
    }

    if (lastPrice < ema20 && ema20 < ema50) {
        return 'SHORT_WEAK';
    }

    return 'NEUTRAL';
}

/* =========================================================
   COİN ANALİZİ
========================================================= */

async function analyzeSymbol(symbol) {
    try {
        const [
            candles5m,
            candles15m,
            candles1h
        ] = await Promise.all([
            getKlines(symbol, '5m', 120),
            getKlines(symbol, '15m', 120),
            getKlines(symbol, '1h', 120)
        ]);

        if (
            candles5m.length < 50 ||
            candles15m.length < 50 ||
            candles1h.length < 50
        ) {
            return null;
        }

        const closes5m = candles5m.map(candle => candle.close);
        const closes15m = candles15m.map(candle => candle.close);
        const closes1h = candles1h.map(candle => candle.close);

        const price = closes5m[closes5m.length - 1];

        if (!price || !Number.isFinite(price)) {
            return null;
        }

        const trend5m = getTrend(candles5m);
        const trend15m = getTrend(candles15m);
        const trend1h = getTrend(candles1h);

        const rsi5m = calculateRSI(closes5m);
        const rsi15m = calculateRSI(closes15m);
        const rsi1h = calculateRSI(closes1h);

        const macd5m = calculateMACD(closes5m);
        const macd15m = calculateMACD(closes15m);
        const macd1h = calculateMACD(closes1h);

        const atr = calculateATR(candles5m);
        const atrPercent = price > 0
            ? (atr / price) * 100
            : 0;

        const volumeRatio = calculateVolumeRatio(candles5m);

        let longPoints = 0;
        let shortPoints = 0;

        /* Trend puanları */

        if (trend1h === 'LONG') {
            longPoints += 3;
        } else if (trend1h === 'LONG_WEAK') {
            longPoints += 1;
        } else if (trend1h === 'SHORT') {
            shortPoints += 3;
        } else if (trend1h === 'SHORT_WEAK') {
            shortPoints += 1;
        }

        if (trend15m === 'LONG') {
            longPoints += 2;
        } else if (trend15m === 'LONG_WEAK') {
            longPoints += 1;
        } else if (trend15m === 'SHORT') {
            shortPoints += 2;
        } else if (trend15m === 'SHORT_WEAK') {
            shortPoints += 1;
        }

        if (trend5m === 'LONG') {
            longPoints += 2;
        } else if (trend5m === 'LONG_WEAK') {
            longPoints += 1;
        } else if (trend5m === 'SHORT') {
            shortPoints += 2;
        } else if (trend5m === 'SHORT_WEAK') {
            shortPoints += 1;
        }

        /* RSI puanları */

        if (rsi1h >= 52 && rsi1h <= 70) {
            longPoints += 2;
        }

        if (rsi1h <= 48 && rsi1h >= 30) {
            shortPoints += 2;
        }

        if (rsi15m >= 52 && rsi15m <= 72) {
            longPoints += 1;
        }

        if (rsi15m <= 48 && rsi15m >= 28) {
            shortPoints += 1;
        }

        if (rsi5m >= 52 && rsi5m <= 75) {
            longPoints += 1;
        }

        if (rsi5m <= 48 && rsi5m >= 25) {
            shortPoints += 1;
        }

        /* MACD puanları */

        if (macd1h.histogram > 0) {
            longPoints += 2;
        } else if (macd1h.histogram < 0) {
            shortPoints += 2;
        }

        if (macd15m.histogram > 0) {
            longPoints += 1;
        } else if (macd15m.histogram < 0) {
            shortPoints += 1;
        }

        if (macd5m.histogram > 0) {
            longPoints += 1;
        } else if (macd5m.histogram < 0) {
            shortPoints += 1;
        }

        /* Hacim puanı */

        if (volumeRatio >= 1.2) {
            if (longPoints > shortPoints) {
                longPoints += 1;
            } else if (shortPoints > longPoints) {
                shortPoints += 1;
            }
        }

        const totalPoints = longPoints + shortPoints;

        let score = 50;

        if (totalPoints > 0) {
            score = 50 + (
                (longPoints - shortPoints) / totalPoints
            ) * 50;
        }

        score = Math.max(0, Math.min(100, score));

        let side = 'NEUTRAL';

        if (score >= 62) {
            side = 'LONG';
        } else if (score <= 38) {
            side = 'SHORT';
        }

        let confirmation = 'İZLE';

        if (
            side === 'LONG' &&
            trend1h === 'LONG' &&
            trend15m === 'LONG'
        ) {
            confirmation = 'LONG TEYİT EDİLDİ';
        } else if (
            side === 'SHORT' &&
            trend1h === 'SHORT' &&
            trend15m === 'SHORT'
        ) {
            confirmation = 'SHORT TEYİT EDİLDİ';
        } else if (side !== 'NEUTRAL') {
            confirmation = 'TEYİT BEKLENİYOR';
        }

        const ticker = appState.tickers.get(symbol);

        return {
            symbol,
            price,
            side,
            score: Math.round(score),
            confirmation,
            change24h: ticker
                ? ticker.priceChangePercent
                : 0,
            quoteVolume: ticker
                ? ticker.quoteVolume
                : 0,
            rsi5m,
            rsi15m,
            rsi1h,
            volumeRatio,
            atrPercent,
            trend5m,
            trend15m,
            trend1h,
            macd5m: macd5m.histogram,
            macd15m: macd15m.histogram,
            macd1h: macd1h.histogram,
            longPoints,
            shortPoints,
            updatedAt: Date.now()
        };
    } catch (error) {
        console.warn(
            `${symbol} analiz edilemedi:`,
            error.message
        );

        return null;
    }
}

/* =========================================================
   SİNYALLERİ RENDER ET
========================================================= */

function renderSignals() {
    const list = $('signalsList');
    const empty = $('signalsEmpty');
    const summary = $('signalSummary');

    if (!list) {
        return;
    }

    list.innerHTML = '';

    const visibleSignals = appState.signals
        .filter(signal => {
            return (
                signal.side !== 'NEUTRAL' &&
                signal.score >= appState.minScore ||
                signal.side === 'SHORT' &&
                signal.score <= (100 - appState.minScore)
            );
        })
        .sort((a, b) => {
            const scoreA = Math.abs(a.score - 50);
            const scoreB = Math.abs(b.score - 50);
            return scoreB - scoreA;
        })
        .slice(0, 30);

    appState.longCount = visibleSignals.filter(
        signal => signal.side === 'LONG'
    ).length;

    appState.shortCount = visibleSignals.filter(
        signal => signal.side === 'SHORT'
    ).length;

    renderStats();

    if (summary) {
        summary.textContent =
            `${visibleSignals.length} güçlü sinyal`;
    }

    if (visibleSignals.length === 0) {
        if (empty) {
            empty.style.display = 'block';
            empty.textContent =
                'Henüz minimum skoru karşılayan güçlü sinyal bulunamadı.';
        }

        return;
    }

    if (empty) {
        empty.style.display = 'none';
    }

    visibleSignals.forEach(signal => {
        const card = document.createElement('div');

        const sideClass =
            signal.side === 'LONG'
                ? 'long'
                : 'short';

        const scoreClass =
            signal.score >= 75
                ? 'high'
                : signal.score >= 62
                    ? 'medium'
                    : 'low';

        const changeSign =
            signal.change24h >= 0 ? '+' : '';

        card.className = `signal-card ${sideClass}`;

        card.innerHTML = `
            <div class="signal-main">
                <div>
                    <div class="signal-symbol">
                        ${escapeHtml(signal.symbol)}
                    </div>

                    <div class="signal-meta">
                        ${escapeHtml(signal.confirmation)}
                    </div>
                </div>

                <div class="signal-side">
                    <div class="signal-direction ${sideClass}">
                        ${signal.side}
                    </div>

                    <div class="signal-score ${scoreClass}">
                        ${signal.score}/100
                    </div>
                </div>
            </div>

            <div class="signal-price-row">
                <strong>${formatPrice(signal.price)}</strong>

                <span class="${signal.change24h >= 0 ? 'positive' : 'negative'}">
                    ${changeSign}${safeNumber(signal.change24h).toFixed(2)}%
                </span>
            </div>

            <div class="signal-details">
                <span>RSI 1H: ${safeNumber(signal.rsi1h).toFixed(1)}</span>
                <span>RSI 15M: ${safeNumber(signal.rsi15m).toFixed(1)}</span>
                <span>RSI 5M: ${safeNumber(signal.rsi5m).toFixed(1)}</span>
                <span>Hacim: ${safeNumber(signal.volumeRatio).toFixed(2)}x</span>
                <span>ATR: ${safeNumber(signal.atrPercent).toFixed(2)}%</span>
            </div>

            <div class="signal-trends">
                <span>5M: ${formatTrend(signal.trend5m)}</span>
                <span>15M: ${formatTrend(signal.trend15m)}</span>
                <span>1H: ${formatTrend(signal.trend1h)}</span>
            </div>

            <div class="signal-footer">
                <span>Hacim: ${formatVolume(signal.quoteVolume)} USDT</span>

                <button
                    class="plan-btn"
                    type="button"
                    data-symbol="${escapeHtml(signal.symbol)}">
                    İşlem planı
                </button>
            </div>
        `;

        list.appendChild(card);
    });

    list.querySelectorAll('.plan-btn').forEach(button => {
        button.addEventListener('click', () => {
            const signal = appState.signals.find(
                item => item.symbol === button.dataset.symbol
            );

            if (signal) {
                showTradePlan(signal);
            }
        });
    });
}

/* =========================================================
   TARAMA
========================================================= */

async function runLiveScan() {
    if (appState.scanning) {
        return;
    }

    appState.scanning = true;

    const scanButton = $('scanButton');

    if (scanButton) {
        scanButton.disabled = true;
        scanButton.textContent = 'Analiz ediliyor...';
    }

    try {
        setConnection('loading', 'Piyasalar yükleniyor...');
        setStatus('Binance Futures piyasaları alınıyor...');

        await loadExchangeInfo();
        await loadTickers();

        const selectedSymbols = Array.from(
            appState.tickers.values()
        )
            .filter(item => item.lastPrice > 0)
            .sort((a, b) => {
                return b.quoteVolume - a.quoteVolume;
            })
            .slice(0, 30)
            .map(item => item.symbol);

        if (!selectedSymbols.length) {
            throw new Error('Analiz edilecek coin bulunamadı.');
        }

        appState.signals = [];

        setConnection('online', 'Binance canlı bağlı');

        for (let i = 0; i < selectedSymbols.length; i++) {
            const symbol = selectedSymbols[i];

            setStatus(
                `Analiz ediliyor: ${symbol} (${i + 1}/${selectedSymbols.length})`
            );

            const result = await analyzeSymbol(symbol);

            if (result) {
                appState.signals.push(result);
            }
        }

        renderSignals();

        setStatus(
            `Tarama tamamlandı. ${appState.signals.length} coin analiz edildi.`
        );

        connectWebSocket();
    } catch (error) {
        console.error('Tarama hatası:', error);

        setConnection('offline', 'Bağlantı başarısız');

        setStatus(
            `Veri alınamadı: ${error.message}`
        );
    } finally {
        appState.scanning = false;

        if (scanButton) {
            scanButton.disabled = false;
            scanButton.textContent = 'Piyasaları Tara';
        }
    }
}

/* =========================================================
   CANLI WEBSOCKET
========================================================= */

function connectWebSocket() {
    if (
        appState.ws &&
        (
            appState.ws.readyState === WebSocket.OPEN ||
            appState.ws.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    try {
        const ws = new WebSocket(BINANCE_WS);

        appState.ws = ws;

        ws.onopen = () => {
            setConnection('online', 'Binance canlı bağlı');
        };

        ws.onmessage = event => {
            try {
                const message = JSON.parse(event.data);
                const tickerList = message.data;

                if (!Array.isArray(tickerList)) {
                    return;
                }

                const validSymbols = new Set(appState.symbols);

                tickerList.forEach(item => {
                    if (!validSymbols.has(item.s)) {
                        return;
                    }

                    appState.tickers.set(item.s, {
                        symbol: item.s,
                        lastPrice: safeNumber(item.c),
                        priceChangePercent: safeNumber(item.P),
                        quoteVolume: safeNumber(item.q)
                    });
                });

                appState.signals.forEach(signal => {
                    const ticker = appState.tickers.get(signal.symbol);

                    if (ticker) {
                        signal.price = ticker.lastPrice;
                        signal.change24h = ticker.priceChangePercent;
                        signal.quoteVolume = ticker.quoteVolume;
                    }
                });

                checkPaperPosition();
                renderSignals();
                renderPositionView();
            } catch (error) {
                console.warn(
                    'Canlı veri işlenemedi:',
                    error.message
                );
            }
        };

        ws.onerror = error => {
            console.warn('WebSocket hatası:', error);
            setConnection('offline', 'Canlı bağlantı hatası');
        };

        ws.onclose = () => {
            appState.ws = null;
            setConnection('offline', 'Bağlantı kapandı');
        };
    } catch (error) {
        console.warn(
            'WebSocket başlatılamadı:',
            error.message
        );
    }
}

/* =========================================================
   İŞLEM PLANI
========================================================= */

function calculateTradePlan(signal) {
    if (!signal || !signal.price || signal.side === 'NEUTRAL') {
        return null;
    }

    const entry = safeNumber(signal.price);

    if (!entry) {
        return null;
    }

    const atrRisk = entry *
        (safeNumber(signal.atrPercent) / 100) *
        1.5;

    const minimumRisk = entry * 0.004;

    const riskDistance = Math.max(
        atrRisk,
        minimumRisk
    );

    let stopLoss;
    let tp1;
    let tp2;
    let tp3;

    if (signal.side === 'LONG') {
        stopLoss = entry - riskDistance;
        tp1 = entry + riskDistance;
        tp2 = entry + riskDistance * 2;
        tp3 = entry + riskDistance * 3;
    } else {
        stopLoss = entry + riskDistance;
        tp1 = entry - riskDistance;
        tp2 = entry - riskDistance * 2;
        tp3 = entry - riskDistance * 3;
    }

    let leverage = 3;

    if (signal.atrPercent <= 1.5) {
        leverage = 5;
    } else if (signal.atrPercent > 3) {
        leverage = 2;
    }

    return {
        symbol: signal.symbol,
        side: signal.side,
        score: signal.score,
        confirmation: signal.confirmation,
        entry,
        stopLoss,
        tp1,
        tp2,
        tp3,
        riskDistance,
        leverage,
        riskReward1: 1,
        riskReward2: 2,
        riskReward3: 3
    };
}

function showTradePlan(signal) {
    const panel = $('tradePlanPanel');
    const symbolBox = $('tradePlanSymbol');
    const content = $('tradePlanContent');

    const plan = calculateTradePlan(signal);

    if (!panel || !symbolBox || !content || !plan) {
        return;
    }

    appState.selectedSignal = signal;
    appState.paperPlanSignal = signal;

    symbolBox.textContent =
        `${plan.symbol} · ${plan.side} · ${plan.score}/100`;

    content.innerHTML = `
        <div class="trade-plan-grid">
            <div class="trade-plan-item">
                <div class="trade-plan-label">Yön</div>
                <div class="trade-plan-value info">
                    ${plan.side}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Sinyal skoru</div>
                <div class="trade-plan-value info">
                    ${plan.score}/100
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Giriş</div>
                <div class="trade-plan-value entry">
                    ${formatPrice(plan.entry)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Stop Loss</div>
                <div class="trade-plan-value stop">
                    ${formatPrice(plan.stopLoss)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">TP1 · R/R 1:1</div>
                <div class="trade-plan-value tp">
                    ${formatPrice(plan.tp1)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">TP2 · R/R 1:2</div>
                <div class="trade-plan-value tp">
                    ${formatPrice(plan.tp2)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">TP3 · R/R 1:3</div>
                <div class="trade-plan-value tp">
                    ${formatPrice(plan.tp3)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Önerilen kaldıraç</div>
                <div class="trade-plan-value info">
                    ${plan.leverage}x
                </div>
            </div>
        </div>

        <div class="trade-plan-note">
            Bu plan teknik göstergelere dayalı yaklaşık bir senaryodur.
            Garanti edilmiş kazanç veya yatırım tavsiyesi değildir.
            Gerçek emir gönderilmez.
        </div>
    `;

    panel.style.display = 'block';

    renderTradeView();
}

function closeTradePlan() {
    const panel = $('tradePlanPanel');

    if (panel) {
        panel.style.display = 'none';
    }

    appState.paperPlanSignal = null;
}

function openPaperTradingPanel() {
    const panel = $('paperTradingPanel');
    const signal = appState.paperPlanSignal;

    if (!panel || !signal) {
        return;
    }

    const plan = calculateTradePlan(signal);

    if (!plan) {
        return;
    }

    panel.style.display = 'block';

    const paperSymbol = $('paperSymbol');

    if (paperSymbol) {
        paperSymbol.textContent =
            `${plan.symbol} · ${plan.side}`;
    }

    updatePaperTradePreview();
}

function closePaperTradingPanel() {
    const panel = $('paperTradingPanel');

    if (panel) {
        panel.style.display = 'none';
    }
}

function updatePaperTradePreview() {
    const preview = $('paperTradePreview');
    const signal = appState.paperPlanSignal;

    if (!preview || !signal) {
        return;
    }

    const plan = calculateTradePlan(signal);

    if (!plan) {
        return;
    }

    const riskPercent = Math.max(
        0.1,
        Math.min(
            10,
            safeNumber($('paperRiskPercent')?.value, 1)
        )
    );

    const leverage = Math.max(
        1,
        Math.min(
            50,
            Math.round(
                safeNumber($('paperLeverage')?.value, plan.leverage)
            )
        )
    );

    const riskAmount =
        appState.paperBalance * (riskPercent / 100);

    const riskDistancePercent =
        plan.entry > 0
            ? (plan.riskDistance / plan.entry) * 100
            : 0;

    const notional =
        riskDistancePercent > 0
            ? riskAmount / (riskDistancePercent / 100)
            : 0;

    const margin = leverage > 0
        ? notional / leverage
        : 0;

    preview.innerHTML = `
        <div class="paper-preview-title">
            Sanal işlem özeti
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Bakiye</span>
            <span class="paper-preview-value">
                ${formatMoney(appState.paperBalance)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Risk</span>
            <span class="paper-preview-value">
                ${riskPercent.toFixed(1)}% · ${riskAmount.toFixed(2)} USDT
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Kaldıraç</span>
            <span class="paper-preview-value">
                ${leverage}x
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Tahmini pozisyon</span>
            <span class="paper-preview-value">
                ${notional.toFixed(2)} USDT
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Kullanılan teminat</span>
            <span class="paper-preview-value">
                ${margin.toFixed(2)} USDT
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Giriş</span>
            <span class="paper-preview-value">
                ${formatPrice(plan.entry)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Stop</span>
            <span class="paper-preview-value">
                ${formatPrice(plan.stopLoss)}
            </span>
        </div>
    `;
}

/* =========================================================
   PAPER TRADING
========================================================= */

function openPaperPosition() {
    const signal = appState.paperPlanSignal;

    if (!signal) {
        setStatus('Önce bir işlem planı seçmelisin.');
        return;
    }

    if (appState.paperOpenPosition) {
        setStatus('Zaten açık bir sanal pozisyon bulunuyor.');
        return;
    }

    const plan = calculateTradePlan(signal);

    if (!plan) {
        setStatus('Sanal işlem planı oluşturulamadı.');
        return;
    }

    const riskPercent = Math.max(
        0.1,
        Math.min(
            10,
            safeNumber($('paperRiskPercent')?.value, 1)
        )
    );

    const leverage = Math.max(
        1,
        Math.min(
            50,
            Math.round(
                safeNumber($('paperLeverage')?.value, plan.leverage)
            )
        )
    );

    const riskAmount =
        appState.paperBalance * (riskPercent / 100);

    const riskDistancePercent =
        plan.entry > 0
            ? plan.riskDistance / plan.entry
            : 0;

    if (!riskDistancePercent) {
        setStatus('Risk mesafesi hesaplanamadı.');
        return;
    }

    const notional = riskAmount / riskDistancePercent;
    const margin = notional / leverage;

    if (margin > appState.paperBalance) {
        setStatus(
            'Bu işlem için gereken teminat sanal bakiyeyi aşıyor.'
        );
        return;
    }

    const position = {
        id: Date.now(),
        symbol: plan.symbol,
        side: plan.side,
        score: plan.score,
        entry: plan.entry,
        stopLoss: plan.stopLoss,
        tp1: plan.tp1,
        tp2: plan.tp2,
        tp3: plan.tp3,
        leverage,
        riskPercent,
        riskAmount,
        notional,
        margin,
        quantity: notional / plan.entry,
        openedAt: Date.now(),
        currentPrice: plan.entry,
        pnl: 0,
        status: 'OPEN'
    };

    appState.paperOpenPosition = position;

    savePaperData();
    renderPositionView();
    renderTradeView();

    closePaperTradingPanel();

    setStatus(
        `${position.symbol} için sanal ${position.side} pozisyon açıldı.`
    );

    showView('position');
}

function calculatePaperPnl(position, currentPrice) {
    if (!position || !currentPrice) {
        return 0;
    }

    const priceDifference = position.side === 'LONG'
        ? currentPrice - position.entry
        : position.entry - currentPrice;

    return priceDifference * position.quantity;
}

function checkPaperPosition() {
    const position = appState.paperOpenPosition;

    if (!position) {
        return;
    }

    const ticker = appState.tickers.get(position.symbol);

    if (!ticker || !ticker.lastPrice) {
        return;
    }

    const currentPrice = ticker.lastPrice;
    const pnl = calculatePaperPnl(position, currentPrice);

    position.currentPrice = currentPrice;
    position.pnl = pnl;

    let closeReason = null;

    if (position.side === 'LONG') {
        if (currentPrice <= position.stopLoss) {
            closeReason = 'STOP LOSS';
        } else if (currentPrice >= position.tp3) {
            closeReason = 'TP3';
        }
    } else {
        if (currentPrice >= position.stopLoss) {
            closeReason = 'STOP LOSS';
        } else if (currentPrice <= position.tp3) {
            closeReason = 'TP3';
        }
    }

    if (closeReason) {
        closePaperPosition(closeReason, currentPrice);
    } else {
        renderPositionView();
    }
}

function closePaperPosition(reason = 'MANUEL', exitPrice = null) {
    const position = appState.paperOpenPosition;

    if (!position) {
        return;
    }

    const ticker = appState.tickers.get(position.symbol);

    const finalPrice = exitPrice ||
        ticker?.lastPrice ||
        position.currentPrice ||
        position.entry;

    const pnl = calculatePaperPnl(position, finalPrice);

    position.currentPrice = finalPrice;
    position.pnl = pnl;
    position.status = 'CLOSED';
    position.closeReason = reason;
    position.closedAt = Date.now();

    appState.paperBalance += pnl;

    appState.paperHistory.unshift({
        ...position
    });

    if (appState.paperHistory.length > 50) {
        appState.paperHistory =
            appState.paperHistory.slice(0, 50);
    }

    appState.paperOpenPosition = null;

    savePaperData();
    renderPositionView();
    renderHistoryView();

    setStatus(
        `${position.symbol} pozisyonu kapandı. ${reason} · PNL: ${pnl.toFixed(2)} USDT`
    );
}

function renderPositionView() {
    const container = $('positionViewContent');

    if (!container) {
        return;
    }

    const position = appState.paperOpenPosition;

    if (!position) {
        container.className = 'empty';
        container.textContent =
            'Şu anda açık sanal pozisyon bulunmuyor.';
        return;
    }

    const pnlClass =
        position.pnl >= 0
            ? 'paper-pnl-positive'
            : 'paper-pnl-negative';

    const positionClass =
        position.side === 'LONG'
            ? 'paper-position-long'
            : 'paper-position-short';

    container.className =
        `paper-open-position ${positionClass}`;

    container.innerHTML = `
        <div class="paper-position-title">
            ${escapeHtml(position.symbol)} · ${position.side}
        </div>

        <div class="paper-position-details">
            <div>Giriş: ${formatPrice(position.entry)}</div>
            <div>Anlık: ${formatPrice(position.currentPrice)}</div>
            <div>Stop: ${formatPrice(position.stopLoss)}</div>
            <div>TP1: ${formatPrice(position.tp1)}</div>
            <div>TP2: ${formatPrice(position.tp2)}</div>
            <div>TP3: ${formatPrice(position.tp3)}</div>
            <div>Kaldıraç: ${position.leverage}x</div>
            <div>Teminat: ${position.margin.toFixed(2)} USDT</div>
            <div class="${pnlClass}">
                PNL: ${position.pnl.toFixed(2)} USDT
            </div>
        </div>

        <div class="actions">
            <button
                id="closeOpenPositionButton"
                class="btn btn-danger"
                type="button">
                Pozisyonu Kapat
            </button>
        </div>
    `;

    const closeButton = $('closeOpenPositionButton');

    if (closeButton) {
        closeButton.addEventListener('click', () => {
            closePaperPosition('MANUEL');
        });
    }
}

function renderHistoryView() {
    const container = $('historyViewContent');

    if (!container) {
        return;
    }

    if (!appState.paperHistory.length) {
        container.className = 'empty';
        container.textContent =
            'Henüz tamamlanmış sanal işlem yok.';
        return;
    }

    container.className = 'paper-history';

    container.innerHTML = `
        <div class="paper-history-title">
            Son işlemler
        </div>

        ${appState.paperHistory.map(item => {
            const win = item.pnl >= 0;

            return `
                <div class="paper-history-item ${
                    win
                        ? 'paper-history-win'
                        : 'paper-history-loss'
                }">
                    <strong>
                        ${escapeHtml(item.symbol)} · ${item.side}
                    </strong>
                    <br>
                    Giriş: ${formatPrice(item.entry)}
                    · Çıkış: ${formatPrice(item.currentPrice)}
                    <br>
                    Sonuç: ${escapeHtml(item.closeReason || '-')}
                    · PNL:
                    <span class="${
                        win
                            ? 'paper-pnl-positive'
                            : 'paper-pnl-negative'
                    }">
                        ${item.pnl.toFixed(2)} USDT
                    </span>
                    <br>
                    <span style="color:var(--muted);">
                        ${formatDate(item.closedAt)}
                    </span>
                </div>
            `;
        }).join('')}
    `;
}

function renderTradeView() {
    const container = $('tradeViewContent');

    if (!container) {
        return;
    }

    const signal = appState.paperPlanSignal;

    if (!signal) {
        container.className = 'empty';
        container.textContent =
            'Piyasalar bölümünden bir sinyalin işlem planını açabilirsin.';
        return;
    }

    const plan = calculateTradePlan(signal);

    if (!plan) {
        container.className = 'empty';
        container.textContent =
            'İşlem planı oluşturulamadı.';
        return;
    }

    container.className = 'trade-plan-grid';

    container.innerHTML = `
        <div class="trade-plan-item">
            <div class="trade-plan-label">Coin</div>
            <div class="trade-plan-value info">
                ${escapeHtml(plan.symbol)}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">Yön</div>
            <div class="trade-plan-value info">
                ${plan.side}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">Giriş</div>
            <div class="trade-plan-value entry">
                ${formatPrice(plan.entry)}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">Stop Loss</div>
            <div class="trade-plan-value stop">
                ${formatPrice(plan.stopLoss)}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">TP1</div>
            <div class="trade-plan-value tp">
                ${formatPrice(plan.tp1)}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">TP2</div>
            <div class="trade-plan-value tp">
                ${formatPrice(plan.tp2)}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">TP3</div>
            <div class="trade-plan-value tp">
                ${formatPrice(plan.tp3)}
            </div>
        </div>

        <div class="trade-plan-item">
            <div class="trade-plan-label">Önerilen kaldıraç</div>
            <div class="trade-plan-value info">
                ${plan.leverage}x
            </div>
        </div>
    `;
}

/* =========================================================
   TEMİZLEME VE AYARLAR
========================================================= */

function clearApp() {
    appState.tickers.clear();
    appState.signals = [];
    appState.marketCount = 0;
    appState.longCount = 0;
    appState.shortCount = 0;
    appState.selectedSignal = null;
    appState.paperPlanSignal = null;

    renderStats();
    renderSignals();

    const empty = $('signalsEmpty');

    if (empty) {
        empty.style.display = 'block';
        empty.textContent = 'Henüz sinyal bulunmuyor.';
    }

    const summary = $('signalSummary');

    if (summary) {
        summary.textContent = 'Henüz veri yok';
    }

    closeTradePlan();
    closePaperTradingPanel();

    setConnection('offline', 'Hazır');
    setStatus('Ekran temizlendi.');
}

function saveSettings() {
    const input = $('minScoreInput');

    const value = Math.max(
        50,
        Math.min(
            95,
            Math.round(
                safeNumber(input?.value, 62)
            )
        )
    );

    appState.minScore = value;

    if (input) {
        input.value = value;
    }

    savePaperData();
    renderSignals();

    setStatus(
        `Minimum sinyal skoru ${value} olarak kaydedildi.`
    );
}

function resetPaperAccount() {
    const confirmed = window.confirm(
        'Sanal bakiye, açık pozisyon ve işlem geçmişi sıfırlansın mı?'
    );

    if (!confirmed) {
        return;
    }

    appState.paperBalance = 1000;
    appState.paperOpenPosition = null;
    appState.paperHistory = [];

    savePaperData();
    renderPositionView();
    renderHistoryView();

    setStatus('Sanal hesap sıfırlandı.');
}

/* =========================================================
   BUTON BAĞLANTILARI
========================================================= */

function bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(button => {
        button.addEventListener('click', () => {
            showView(button.dataset.view);
        });
    });
}

function bindActions() {
    const scanButton = $('scanButton');
    const clearButton = $('clearButton');
    const closeTradePlanButton = $('closeTradePlan');
    const paperTradeButton = $('paperTradeButton');
    const closePaperTradingButton = $('closePaperTrading');
    const confirmPaperTradeButton = $('confirmPaperTrade');
    const saveSettingsButton = $('saveSettingsButton');
    const resetPaperButton = $('resetPaperButton');

    if (scanButton) {
        scanButton.addEventListener('click', runLiveScan);
    }

    if (clearButton) {
        clearButton.addEventListener('click', clearApp);
    }

    if (closeTradePlanButton) {
        closeTradePlanButton.addEventListener(
            'click',
            closeTradePlan
        );
    }

    if (paperTradeButton) {
        paperTradeButton.addEventListener(
            'click',
            openPaperTradingPanel
        );
    }

    if (closePaperTradingButton) {
        closePaperTradingButton.addEventListener(
            'click',
            closePaperTradingPanel
        );
    }

    if (confirmPaperTradeButton) {
        confirmPaperTradeButton.addEventListener(
            'click',
            openPaperPosition
        );
    }

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener(
            'click',
            saveSettings
        );
    }

    if (resetPaperButton) {
        resetPaperButton.addEventListener(
            'click',
            resetPaperAccount
        );
    }

    const riskInput = $('paperRiskPercent');
    const leverageInput = $('paperLeverage');

    if (riskInput) {
        riskInput.addEventListener(
            'input',
            updatePaperTradePreview
        );
    }

    if (leverageInput) {
        leverageInput.addEventListener(
            'input',
            updatePaperTradePreview
        );
    }
}

/* =========================================================
   BAŞLAT
========================================================= */

function initApp() {
    loadSavedPaperData();
    bindNavigation();
    bindActions();

    renderStats();
    renderPositionView();
    renderHistoryView();
    renderTradeView();

    setConnection('offline', 'Hazır');
    setStatus(
        'Hazır. Piyasaları Tara butonuna basarak başlayabilirsin.'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
