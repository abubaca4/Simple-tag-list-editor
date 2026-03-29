(function () {
    const FONT_URLS = [
        'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansSymbols/unhinted/otf/NotoSansSymbols-Regular.otf',
        'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansSymbols2/unhinted/otf/NotoSansSymbols2-Regular.otf',
        'https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/font/OpenMoji-color-glyf_colr_0/OpenMoji-color-glyf_colr_0.ttf'
    ];

    const CACHE_KEY = 'emoji_vector_cache';
    const SYMBOL_REGEX = /[\p{Extended_Pictographic}\u{1F300}-\u{1F5FF}]/gu;

    let cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    let isCacheUpdated = false;
    let opentype = null;
    const loadedFonts = new Map();
    let isMutatingDOM = false; // Флаг для предотвращения бесконечного цикла MutationObserver

    // Добавляем необходимые стили для правильного копирования и отображения
    function injectStyles() {
        if (document.getElementById('emoji-polyfill-styles')) return;
        const style = document.createElement('style');
        style.id = 'emoji-polyfill-styles';
        style.textContent = `
      .emoji-polyfill-wrap {
        display: inline-flex;
        align-items: center;
        position: relative;
        vertical-align: baseline;
      }
      .emoji-polyfill-original {
        position: absolute;
        opacity: 0;
        pointer-events: none;
        width: 1px;
        height: 1px;
        overflow: hidden;
        /* Оставляем текст доступным для выделения */
      }
      .emoji-polyfill-svg {
        user-select: none;
        -webkit-user-select: none;
        pointer-events: none;
        display: inline-block;
      }
    `;
        document.head.appendChild(style);
    }

    // Настройка Canvas для проверки отрисовки
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.textBaseline = 'top';
    ctx.font = '16px Arial, sans-serif';

    ctx.fillText('\uFFFF', 0, 0);
    const tofuData = ctx.getImageData(0, 0, 20, 20).data;

    function checkCanvasRender(char) {
        ctx.clearRect(0, 0, 20, 20);
        ctx.fillText(char, 0, 0);
        const charData = ctx.getImageData(0, 0, 20, 20).data;
        let hasPixels = false;
        let isTofu = true;

        for (let i = 0; i < charData.length; i += 4) {
            if (charData[i + 3] > 0) hasPixels = true;
            if (charData[i] !== tofuData[i] || charData[i + 1] !== tofuData[i + 1] ||
                charData[i + 2] !== tofuData[i + 2] || charData[i + 3] !== tofuData[i + 3]) {
                isTofu = false;
            }
        }
        return hasPixels && !isTofu;
    }

    // Получение SVG с последовательным поиском по шрифтам
    async function getSvgFromFont(char) {
        if (!opentype) {
            try {
                const module = await import('https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.js');
                opentype = module.default || module;
            } catch (err) {
                console.error('[EmojiPolyfill] Ошибка загрузки opentype.js:', err);
                return 'non-vector';
            }
        }

        for (const fontUrl of FONT_URLS) {
            let font = loadedFonts.get(fontUrl);

            if (!font) {
                try {
                    const fontBuffer = await fetch(fontUrl).then(res => res.arrayBuffer());
                    font = opentype.parse(fontBuffer);
                    loadedFonts.set(fontUrl, font);
                } catch (err) {
                    console.warn(`[EmojiPolyfill] Ошибка загрузки шрифта ${fontUrl}:`, err);
                    continue; // Пробуем следующий шрифт
                }
            }

            const glyph = font.charToGlyph(char);
            // Если глиф не найден, opentype возвращает "notdef" (index 0) или без unicode
            if (glyph && glyph.unicode !== undefined && glyph.index !== 0) {
                const fontSize = font.unitsPerEm;
                const path = glyph.getPath(0, font.ascender, fontSize);
                const pathData = path.toSVG().match(/d="([^"]+)"/);

                if (pathData) {
                    const advanceWidth = glyph.advanceWidth || fontSize;
                    const emHeight = font.ascender - font.descender;
                    const svgWidth = advanceWidth / fontSize;
                    const svgHeight = emHeight / fontSize;
                    const vAlign = font.descender / fontSize;

                    return `<svg class="emoji-polyfill-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${advanceWidth} ${emHeight}" preserveAspectRatio="xMinYMin meet" style="width:${svgWidth}em; height:${svgHeight}em; margin-bottom:${vAlign}em;"><path d="${pathData[1]}" fill="currentColor"/></svg>`;
                }
            }
        }

        return 'non-vector'; // Ни один шрифт не содержит нормального вектора для символа
    }

    // Функция обработки узлов
    async function processNodes(rootNodes) {
        const textNodes = [];
        const uniqueSymbols = new Set();

        // Собираем все текстовые узлы
        for (const root of rootNodes) {
            if (root.nodeType === Node.TEXT_NODE) {
                const parentTag = root.parentElement ? root.parentElement.tagName : '';
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(parentTag)) continue;
                if (root.nodeValue.match(SYMBOL_REGEX)) {
                    textNodes.push(root);
                }
            } else if (root.nodeType === Node.ELEMENT_NODE) {
                // Игнорируем узлы, которые мы уже обернули
                if (root.classList && root.classList.contains('emoji-polyfill-wrap')) continue;

                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    const parent = node.parentElement;
                    if (parent && (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(parent.tagName) || parent.classList.contains('emoji-polyfill-wrap') || parent.classList.contains('emoji-polyfill-original'))) {
                        continue;
                    }
                    if (node.nodeValue.match(SYMBOL_REGEX)) {
                        textNodes.push(node);
                    }
                }
            }
        }

        if (textNodes.length === 0) return;

        // Собираем уникальные символы
        textNodes.forEach(node => {
            const matches = node.nodeValue.match(SYMBOL_REGEX);
            if (matches) matches.forEach(char => uniqueSymbols.add(char));
        });

        // Обновляем кэш
        for (const char of uniqueSymbols) {
            if (cache[char]) continue;

            if (checkCanvasRender(char)) {
                cache[char] = 'Correct';
            } else {
                cache[char] = await getSvgFromFont(char);
            }
            isCacheUpdated = true;
        }

        if (isCacheUpdated) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            isCacheUpdated = false;
        }

        // Применяем замены
        isMutatingDOM = true; // Отключаем реакцию Observer'а

        for (const node of textNodes) {
            if (!node.parentNode) continue;

            let text = node.nodeValue;
            let needsReplacement = false;

            for (const char of uniqueSymbols) {
                if (cache[char] && cache[char].startsWith('<svg') && text.includes(char)) {
                    needsReplacement = true;
                    break;
                }
            }

            if (needsReplacement) {
                const fragment = document.createDocumentFragment();
                let currentIndex = 0;

                text.replace(SYMBOL_REGEX, (match, offset) => {
                    if (cache[match] && cache[match].startsWith('<svg')) {
                        if (offset > currentIndex) {
                            fragment.appendChild(document.createTextNode(text.slice(currentIndex, offset)));
                        }
                        // Создаем обертку для правильного копирования
                        const span = document.createElement('span');
                        span.className = 'emoji-polyfill-wrap';
                        span.innerHTML = `
              <span class="emoji-polyfill-original">${match}</span>
              ${cache[match]}
            `;
                        fragment.appendChild(span);
                        currentIndex = offset + match.length;
                    }
                    return match;
                });

                if (currentIndex < text.length) {
                    fragment.appendChild(document.createTextNode(text.slice(currentIndex)));
                }
                node.parentNode.replaceChild(fragment, node);
            }
        }

        // Даем браузеру время отрендерить, затем снова слушаем изменения
        setTimeout(() => { isMutatingDOM = false; }, 0);
    }

    // Инициализация
    function init() {
        injectStyles();

        // Первоначальный проход по всей странице
        processNodes([document.body]);

        // Настройка MutationObserver для динамических элементов
        const observer = new MutationObserver((mutations) => {
            if (isMutatingDOM) return;

            const nodesToProcess = [];
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => nodesToProcess.push(node));
                } else if (mutation.type === 'characterData') {
                    nodesToProcess.push(mutation.target);
                }
            }

            if (nodesToProcess.length > 0) {
                processNodes(nodesToProcess);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    // Запуск при загрузке DOM или сразу, если уже загружен
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Делаем функцию доступной глобально на случай ручного вызова
    window.forceEmojiPolyfill = () => processNodes([document.body]);
})();