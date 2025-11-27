class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.variantTags = new Map();
        
        // Кэширование DOM элементов
        this.domElements = {};
        
        // Массив всех тегов в порядке вывода
        this.allTagsInOrder = [];
        
        this.initialize();
    }

    async initialize() {
        try {
            // Кэшируем DOM элементы
            this.cacheDOMElements();
            
            await this.loadTagsData();
            if (this.tagsData) {
                this.showMainInterface();
                this.setupEventListeners();
                this.setupInitialState();
                this.renderTags();
                this.parseInitialInput();
                this.updateLimitDisplay();
                this.updateAlternativeSection();
                this.setupScrollIndicators();
            } else {
                this.showErrorMessage('Неизвестная ошибка загрузки конфигурации');
            }
        } catch (error) {
            console.error('Ошибка инициализации:', error);
            this.showErrorMessage(`Ошибка инициализации: ${error.message}`);
        }
    }

    cacheDOMElements() {
        this.domElements = {
            loadingMessage: document.getElementById('loadingMessage'),
            errorMessage: document.getElementById('errorMessage'),
            errorDetails: document.getElementById('errorDetails'),
            mainContainer: document.getElementById('mainContainer'),
            tagsInput: document.getElementById('tagsInput'),
            limitCheckbox: document.getElementById('limitCheckbox'),
            limitDisplay: document.getElementById('limitDisplay'),
            alternativeSection: document.getElementById('alternativeSection'),
            alternativeOutput: document.getElementById('alternativeOutput'),
            removeDuplicatesCheckbox: document.getElementById('removeDuplicatesCheckbox'),
            tagsContainer: document.getElementById('tagsContainer'),
            leftScrollHint: document.getElementById('leftScrollHint'),
            rightScrollHint: document.getElementById('rightScrollHint')
        };
    }

    showMainInterface() {
        console.log('✅ Показываем основной интерфейс');
        this.domElements.loadingMessage.classList.add('util-hidden');
        this.domElements.errorMessage.classList.add('util-hidden');
        this.domElements.mainContainer.classList.remove('util-hidden');
    }

    getConfigFileName() {
        const urlParams = new URLSearchParams(window.location.search);
        const configName = urlParams.get('conf');
        return configName && !configName.endsWith('.json') ? `${configName}.json` : (configName || 'tags.json');
    }

    async loadTagsData() {
        const configFile = this.getConfigFileName();

        try {
            const response = await fetch(configFile);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.tagsData = await response.json();
            this.initializeCategories();
            console.log(`✅ Загружена конфигурация: ${configFile}`);
            return true;
        } catch (error) {
            console.error(`❌ Ошибка загрузки ${configFile}:`, error);

            if (configFile !== 'tags.json') {
                try {
                    console.log('🔄 Пробуем загрузить fallback конфигурацию...');
                    const fallbackResponse = await fetch('tags.json');
                    if (fallbackResponse.ok) {
                        this.tagsData = await fallbackResponse.json();
                        this.initializeCategories();
                        console.log('✅ Загружена fallback конфигурация: tags.json');
                        return true;
                    }
                } catch (fallbackError) {
                    console.error('❌ Ошибка загрузки fallback файла:', fallbackError);
                }
            }

            this.showErrorMessage(`Не удалось загрузить файл конфигурации: ${configFile}`);
            return false;
        }
    }

    showErrorMessage(errorText) {
        console.error('❌ Показываем ошибку:', errorText);
        this.domElements.loadingMessage.classList.add('util-hidden');
        this.domElements.errorDetails.textContent = errorText;
        this.domElements.errorMessage.classList.remove('util-hidden');
        this.domElements.mainContainer.classList.add('util-hidden');
    }

    setupInitialState() {
        this.domElements.limitCheckbox.checked = true;
    }

    parseInitialInput() {
        const initialValue = this.domElements.tagsInput.value.trim();

        if (initialValue) {
            this.parseInputString(initialValue);
        } else {
            this.clearAllSelections();
        }

        this.updateDisplay();
    }

    initializeCategories() {
        this.categories.clear();
        this.variantTags.clear();
        this.allTagsInOrder = [];

        this.tagsData.categories.forEach(category => {
            const categoryData = {
                name: category.name,
                type: category.type,
                requirement: category.requirement || 'none',
                description: category.description || '',
                tags: new Map(),
                selectedTags: new Set(),
                orderedTags: [],
                variantGroups: new Map(),
                selectedVariants: new Map(),
                domElement: null // Будет установлено при рендеринге
            };

            category.tags.forEach(tag => {
                const names = Array.isArray(tag.name) ? tag.name : [tag.name];
                const mainName = names[0];

                names.forEach(name => {
                    categoryData.tags.set(name, {
                        name: name,
                        mainName: mainName,
                        alternative: tag.alternative || '',
                        subgroup: tag.subgroup || '',
                        description: tag.description || '',
                        isVariant: name !== mainName,
                        isMainTag: tag.main || false
                    });

                    this.variantTags.set(name, mainName);
                });

                if (names.length > 1) {
                    categoryData.variantGroups.set(mainName, names);
                }
            });

            this.categories.set(category.name, categoryData);
        });

        // Создаем массив всех тегов в порядке вывода
        this.buildAllTagsInOrder();
    }

    buildAllTagsInOrder() {
        this.allTagsInOrder = [];
        
        this.tagsData.categories.forEach(categoryConfig => {
            const categoryData = this.categories.get(categoryConfig.name);
            
            categoryConfig.tags.forEach(tagConfig => {
                const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                const mainName = names[0];
                
                names.forEach(name => {
                    this.allTagsInOrder.push({
                        name: name,
                        mainName: mainName,
                        category: categoryConfig.name,
                        categoryData: categoryData,
                        tagConfig: tagConfig
                    });
                });
            });
        });
    }

    setupEventListeners() {
        const tagsInput = this.domElements.tagsInput;
        const limitCheckbox = this.domElements.limitCheckbox;
        const removeDuplicatesCheckbox = this.domElements.removeDuplicatesCheckbox;

        tagsInput.addEventListener('input', () => {
            this.parseInputString(tagsInput.value);
            this.updateDisplay();
        });

        limitCheckbox.addEventListener('change', () => {
            this.updateDisplay();
        });

        removeDuplicatesCheckbox.addEventListener('change', () => {
            this.updateAlternativeSection();
        });

        document.body.addEventListener('click', (e) => {
            const container = this.domElements.mainContainer;
            const isClickOnEmptySpace = !container.contains(e.target) && e.target !== container;

            if (isClickOnEmptySpace) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    setupScrollIndicators() {
        const leftHint = this.domElements.leftScrollHint;
        const rightHint = this.domElements.rightScrollHint;
        const container = this.domElements.mainContainer;
        
        if (!container) return;
        
        const updateScrollIndicators = () => {
            const scrollY = window.scrollY;
            const viewportWidth = window.innerWidth;
            const containerWidth = container.offsetWidth;
            const hasEmptySpace = viewportWidth > containerWidth + 200;
            
            if (scrollY > 100 && hasEmptySpace) {
                leftHint.classList.add('visible');
                rightHint.classList.add('visible');
            } else {
                leftHint.classList.remove('visible');
                rightHint.classList.remove('visible');
            }
        };
        
        const scrollToTop = () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        
        leftHint.addEventListener('click', scrollToTop);
        rightHint.addEventListener('click', scrollToTop);
        
        window.addEventListener('scroll', updateScrollIndicators);
        window.addEventListener('resize', updateScrollIndicators);
        updateScrollIndicators();
    }

    renderTags() {
        const container = this.domElements.tagsContainer;
        container.innerHTML = '';

        this.categories.forEach((categoryData, categoryName) => {
            const categoryElement = this.createCategoryElement(categoryName, categoryData);
            container.appendChild(categoryElement);
            // Сохраняем ссылку на DOM элемент категории
            categoryData.domElement = categoryElement;
        });
    }

    createCategoryElement(categoryName, categoryData) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'category-title-container';

        const title = document.createElement('div');
        title.className = 'category-title';
        title.textContent = categoryName;
        titleContainer.appendChild(title);

        if (categoryData.description) {
            const helpButton = document.createElement('button');
            helpButton.className = 'category-help-button';
            helpButton.innerHTML = '?';
            helpButton.title = categoryData.description;

            const tooltip = document.createElement('div');
            tooltip.className = 'category-tooltip';
            tooltip.textContent = categoryData.description;

            helpButton.appendChild(tooltip);
            titleContainer.appendChild(helpButton);
        }

        categoryDiv.appendChild(titleContainer);

        const warningElement = document.createElement('div');
        warningElement.className = 'category-warning util-hidden';
        categoryDiv.appendChild(warningElement);

        const subgroups = this.groupTagsBySubgroup(categoryData);

        subgroups.forEach((tags, subgroupName) => {
            const shouldShowSubgroupName = subgroupName && !subgroupName.startsWith('!');
            const displaySubgroupName = subgroupName.startsWith('!') ? subgroupName.substring(1) : subgroupName;

            if (subgroupName) {
                const subgroupDiv = document.createElement('div');
                subgroupDiv.className = 'subgroup';

                if (shouldShowSubgroupName) {
                    const subgroupTitle = document.createElement('div');
                    subgroupTitle.className = 'subgroup-title';
                    subgroupTitle.textContent = displaySubgroupName;
                    subgroupDiv.appendChild(subgroupTitle);
                }

                const tagsGroup = this.createTagsGroup(tags, categoryName, categoryData);
                subgroupDiv.appendChild(tagsGroup);
                categoryDiv.appendChild(subgroupDiv);
            } else {
                const tagsGroup = this.createTagsGroup(tags, categoryName, categoryData);
                categoryDiv.appendChild(tagsGroup);
            }
        });

        return categoryDiv;
    }

    groupTagsBySubgroup(categoryData) {
        const subgroups = new Map();
        const processedMainNames = new Set();

        categoryData.variantGroups.forEach((variants, mainName) => {
            const firstVariant = variants[0];
            const tag = categoryData.tags.get(firstVariant);
            if (tag) {
                const subgroup = tag.subgroup || '';
                if (!subgroups.has(subgroup)) subgroups.set(subgroup, []);
                
                const variantGroup = {
                    type: 'variant',
                    mainName: mainName,
                    variants: variants.map(variantName => categoryData.tags.get(variantName)),
                    description: tag.description
                };
                subgroups.get(subgroup).push(variantGroup);
                processedMainNames.add(mainName);
            }
        });

        categoryData.tags.forEach(tag => {
            if (tag.isVariant || processedMainNames.has(tag.mainName)) return;

            const subgroup = tag.subgroup || '';
            if (!subgroups.has(subgroup)) subgroups.set(subgroup, []);
            
            subgroups.get(subgroup).push({
                type: 'single',
                tag: tag
            });
        });

        return subgroups;
    }

    createTagsGroup(tags, categoryName, categoryData) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'tags-group';

        tags.forEach(item => {
            if (item.type === 'variant') {
                const variantGroup = this.createVariantGroup(item, categoryName, categoryData);
                groupDiv.appendChild(variantGroup);
            } else {
                const button = this.createTagButton(item.tag, categoryName, categoryData);
                groupDiv.appendChild(button);
            }
        });

        return groupDiv;
    }

    createVariantGroup(variantGroup, categoryName, categoryData) {
        const variantContainer = document.createElement('div');
        variantContainer.className = 'variant-group';

        const variantButtons = document.createElement('div');
        variantButtons.className = 'variant-buttons';

        variantGroup.variants.forEach(tag => {
            const button = this.createTagButton(tag, categoryName, categoryData);
            variantButtons.appendChild(button);
        });

        variantContainer.appendChild(variantButtons);

        if (variantGroup.description) {
            const description = document.createElement('div');
            description.className = 'variant-description';
            description.textContent = variantGroup.description;
            variantContainer.appendChild(description);
        }

        return variantContainer;
    }

    createTagButton(tag, categoryName, categoryData) {
        const button = document.createElement('button');
        button.className = 'tag-button util-tag-base';
        button.textContent = tag.name;

        if (tag.isMainTag) button.classList.add('main-tag');
        if (tag.description) button.title = tag.description;

        button.addEventListener('click', () => {
            this.handleTagClick(categoryName, tag.name, categoryData.type);
        });

        return button;
    }

    handleTagClick(categoryName, clickedTagName, categoryType) {
        const categoryData = this.categories.get(categoryName);
        const tag = categoryData.tags.get(clickedTagName);
        const mainName = tag.mainName;

        switch (categoryType) {
            case 'single':
                this.handleSingleCategory(categoryData, mainName, clickedTagName);
                break;
            case 'ordered':
                this.handleOrderedCategory(categoryData, mainName, clickedTagName);
                break;
            default:
                this.handleStandardCategory(categoryData, clickedTagName, mainName);
        }

        this.updateDisplay();
    }

    handleSingleCategory(categoryData, mainName, clickedTagName) {
        if (categoryData.selectedTags.has(mainName)) {
            categoryData.selectedTags.delete(mainName);
            this.selectedTags.delete(mainName);
            categoryData.selectedVariants.delete(mainName);
        } else {
            if (categoryData.selectedTags.size > 0) {
                const previousTag = Array.from(categoryData.selectedTags)[0];
                categoryData.selectedTags.delete(previousTag);
                this.selectedTags.delete(previousTag);
                categoryData.selectedVariants.delete(previousTag);
            }
            categoryData.selectedTags.add(mainName);
            this.selectedTags.set(mainName, categoryData.name);
            categoryData.selectedVariants.set(mainName, clickedTagName);
        }
    }

    handleOrderedCategory(categoryData, mainName, clickedTagName) {
        if (categoryData.selectedTags.has(mainName)) {
            const index = categoryData.orderedTags.indexOf(mainName);
            categoryData.orderedTags.splice(index, 1);
            categoryData.selectedTags.delete(mainName);
            this.selectedTags.delete(mainName);
            categoryData.selectedVariants.delete(mainName);
        } else {
            categoryData.orderedTags.push(mainName);
            categoryData.selectedTags.add(mainName);
            this.selectedTags.set(mainName, categoryData.name);
            categoryData.selectedVariants.set(mainName, clickedTagName);
        }
    }

    handleStandardCategory(categoryData, clickedTagName, mainName) {
        const variantGroup = categoryData.variantGroups.get(mainName);
        const isCurrentlySelected = categoryData.selectedTags.has(mainName);
        const currentVariant = categoryData.selectedVariants.get(mainName);

        if (isCurrentlySelected && currentVariant === clickedTagName) {
            categoryData.selectedTags.delete(mainName);
            this.selectedTags.delete(mainName);
            categoryData.selectedVariants.delete(mainName);
        } else {
            categoryData.selectedTags.add(mainName);
            this.selectedTags.set(mainName, categoryData.name);
            categoryData.selectedVariants.set(mainName, clickedTagName);
        }
    }

    createResultString() {
        const tags = [];

        this.tagsData.categories.forEach(categoryConfig => {
            const categoryData = this.categories.get(categoryConfig.name);
            if (!categoryData) return;

            if (categoryData.type === 'ordered') {
                categoryData.orderedTags.forEach(mainName => {
                    const selectedVariant = categoryData.selectedVariants.get(mainName) || mainName;
                    tags.push(selectedVariant);
                });
            } else if (categoryData.type === 'single') {
                if (categoryData.selectedTags.size > 0) {
                    const mainName = Array.from(categoryData.selectedTags)[0];
                    const selectedVariant = categoryData.selectedVariants.get(mainName) || mainName;
                    tags.push(selectedVariant);
                }
            } else {
                const categoryTagsInOrder = [];
                categoryConfig.tags.forEach(tagConfig => {
                    const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                    const mainName = names[0];

                    if (categoryData.selectedTags.has(mainName)) {
                        const selectedVariant = categoryData.selectedVariants.get(mainName) || mainName;
                        categoryTagsInOrder.push(selectedVariant);
                    }
                });
                tags.push(...categoryTagsInOrder);
            }
        });

        return tags.join(this.tagsData.separator);
    }

    processCategoryTags(processCallback) {
        const results = [];

        this.tagsData.categories.forEach(categoryConfig => {
            const categoryData = this.categories.get(categoryConfig.name);
            if (!categoryData) return;

            processCallback(categoryConfig, categoryData, results);
        });

        return results;
    }

    createAlternativeString(removeDuplicates = false) {
        const alternativeTags = [];
        const seenAlternatives = new Set();

        this.processCategoryTags((categoryConfig, categoryData) => {
            this.processSelectedTags(categoryConfig, categoryData, (tag, mainName) => {
                if (tag && tag.alternative) {
                    if (removeDuplicates) {
                        const normalizedAlternative = this.normalizeString(tag.alternative);
                        if (!seenAlternatives.has(normalizedAlternative)) {
                            alternativeTags.push(tag.alternative);
                            seenAlternatives.add(normalizedAlternative);
                        }
                    } else {
                        alternativeTags.push(tag.alternative);
                    }
                }
            });
        });

        return alternativeTags.join(this.tagsData.alternativeSeparator);
    }

    processSelectedTags(categoryConfig, categoryData, callback) {
        if (categoryData.type === 'ordered') {
            categoryData.orderedTags.forEach(mainName => {
                const tag = categoryData.tags.get(mainName);
                callback(tag, mainName);
            });
        } else if (categoryData.type === 'single') {
            if (categoryData.selectedTags.size > 0) {
                const mainName = Array.from(categoryData.selectedTags)[0];
                const tag = categoryData.tags.get(mainName);
                callback(tag, mainName);
            }
        } else {
            categoryConfig.tags.forEach(tagConfig => {
                const names = Array.isArray(tagConfig.name) ? tagConfig.name : [tagConfig.name];
                const mainName = names[0];

                if (categoryData.selectedTags.has(mainName) && tagConfig.alternative) {
                    callback(tagConfig, mainName);
                }
            });
        }
    }

    normalizeString(str) {
        return str
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s\[\]\/:\.\-]/g, '');
    }

    parseInputString(inputString) {
        this.clearAllSelections();

        const tags = inputString.split(this.tagsData.separator)
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

        if (tags.length === 0) return;

        let lastFoundIndex = -1;

        tags.forEach(tag => {
            // Ищем тег в массиве allTagsInOrder, начиная с позиции после последнего найденного
            let foundIndex = -1;
            
            // Поиск от lastFoundIndex + 1 до конца
            for (let i = lastFoundIndex + 1; i < this.allTagsInOrder.length; i++) {
                if (this.allTagsInOrder[i].name === tag) {
                    foundIndex = i;
                    break;
                }
            }
            
            // Если не нашли, ищем с начала до lastFoundIndex
            if (foundIndex === -1) {
                for (let i = 0; i <= lastFoundIndex; i++) {
                    if (this.allTagsInOrder[i].name === tag) {
                        foundIndex = i;
                        break;
                    }
                }
            }

            if (foundIndex !== -1) {
                const tagInfo = this.allTagsInOrder[foundIndex];
                const categoryData = tagInfo.categoryData;
                const mainName = tagInfo.mainName;

                if (categoryData.type === 'single') {
                    categoryData.selectedTags.clear();
                    categoryData.selectedTags.add(mainName);
                    this.selectedTags.set(mainName, tagInfo.category);
                    categoryData.selectedVariants.set(mainName, tagInfo.name);
                } else if (categoryData.type === 'ordered') {
                    if (!categoryData.orderedTags.includes(mainName)) {
                        categoryData.orderedTags.push(mainName);
                        categoryData.selectedTags.add(mainName);
                        this.selectedTags.set(mainName, tagInfo.category);
                        categoryData.selectedVariants.set(mainName, tagInfo.name);
                    }
                } else {
                    categoryData.selectedTags.add(mainName);
                    this.selectedTags.set(mainName, tagInfo.category);
                    categoryData.selectedVariants.set(mainName, tagInfo.name);
                }

                lastFoundIndex = foundIndex;
            }
        });
    }

    clearAllSelections() {
        this.selectedTags.clear();
        this.categories.forEach(category => {
            category.selectedTags.clear();
            category.orderedTags = [];
            category.selectedVariants.clear();
        });
    }

    updateDisplay() {
        this.updateInputField();
        this.updateTagsAppearance();
        this.updateAlternativeSection();
        this.updateLimitDisplay();
        this.updateCategoryWarnings();
    }

    updateInputField() {
        const resultString = this.createResultString();
        const isLimitEnabled = this.domElements.limitCheckbox.checked;

        if (isLimitEnabled && resultString.length > this.tagsData.characterLimit) {
            this.parseInputString(this.domElements.tagsInput.value);
            this.updateTagsAppearance();
        } else {
            this.domElements.tagsInput.value = resultString;
        }
    }

    updateTagsAppearance() {
        this.categories.forEach((categoryData, categoryName) => {
            if (!categoryData.domElement) return;

            const buttons = categoryData.domElement.querySelectorAll('.tag-button');

            buttons.forEach(button => {
                const tagName = button.textContent;
                const tag = categoryData.tags.get(tagName);
                if (!tag) return;

                const mainName = tag.mainName;
                const isGroupSelected = categoryData.selectedTags.has(mainName);
                const selectedVariant = categoryData.selectedVariants.get(mainName);
                const isThisVariantSelected = isGroupSelected && selectedVariant === tagName;

                button.classList.toggle('selected', isThisVariantSelected);

                if (categoryData.type === 'ordered' && isThisVariantSelected) {
                    const orderIndex = categoryData.orderedTags.indexOf(mainName);
                    if (orderIndex !== -1) {
                        button.classList.add('ordered');
                        button.setAttribute('data-order', orderIndex + 1);
                    } else {
                        button.classList.remove('ordered');
                        button.removeAttribute('data-order');
                    }
                } else {
                    button.classList.remove('ordered');
                    button.removeAttribute('data-order');
                }
            });
        });
    }

    updateCategoryWarnings() {
        this.categories.forEach((categoryData, categoryName) => {
            if (!categoryData.domElement) return;

            const warningElement = categoryData.domElement.querySelector('.category-warning');

            if (categoryData.requirement === 'none') {
                warningElement.classList.add('util-hidden');
                return;
            }

            let requirementMet = false;
            let warningText = '';

            if (categoryData.requirement === 'atLeastOne') {
                requirementMet = categoryData.selectedTags.size > 0;
                warningText = 'Необходимо выбрать хотя бы один тег';
            } else if (categoryData.requirement === 'atLeastOneMain') {
                requirementMet = Array.from(categoryData.selectedTags).some(mainName => {
                    const tag = categoryData.tags.get(mainName);
                    return tag && tag.isMainTag;
                });
                warningText = 'Необходимо выбрать хотя бы один главный тег';
            }

            if (!requirementMet) {
                warningElement.textContent = warningText;
                warningElement.classList.remove('util-hidden');
            } else {
                warningElement.classList.add('util-hidden');
            }
        });
    }

    updateAlternativeSection() {
        const alternativeString = this.createAlternativeString(this.domElements.removeDuplicatesCheckbox.checked);

        if (alternativeString) {
            this.domElements.alternativeSection.classList.remove('util-hidden');
            this.domElements.alternativeOutput.value = alternativeString;
        } else {
            this.domElements.alternativeSection.classList.add('util-hidden');
        }
    }

    updateLimitDisplay() {
        const currentLength = this.createResultString().length;
        const limit = this.tagsData.characterLimit;

        this.domElements.limitDisplay.textContent = `${currentLength}/${limit}`;

        if (this.domElements.limitCheckbox.checked && currentLength > limit) {
            this.domElements.limitDisplay.classList.add('exceeded');
        } else {
            this.domElements.limitDisplay.classList.remove('exceeded');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM загружен, инициализируем TagsManager');
    new TagsManager();
});