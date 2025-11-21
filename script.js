class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.initialize();
    }

    async initialize() {
        await this.loadTagsData();
        this.setupEventListeners();
        this.setupInitialState();
        this.renderTags();
        this.parseInitialInput(); // Новая функция для парсинга начальной строки
        this.updateLimitDisplay();
        this.updateAlternativeSection();
    }

    async loadTagsData() {
        try {
            const response = await fetch('tags.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.tagsData = await response.json();
            this.initializeCategories();
        } catch (error) {
            console.error('Ошибка загрузки tags.json:', error);
            // Fallback данные на случай ошибки
            this.tagsData = this.getFallbackData();
            this.initializeCategories();
        }
    }

    setupInitialState() {
        // Автоматически включаем чекбокс ограничения длины
        const limitCheckbox = document.getElementById('limitCheckbox');
        limitCheckbox.checked = true;
    }

    parseInitialInput() {
        const input = document.getElementById('tagsInput');
        const initialValue = input.value.trim();
        
        if (initialValue) {
            // Если в поле ввода уже есть значение, парсим его
            this.parseInputString(initialValue);
        } else {
            // Если поле пустое, устанавливаем пустое состояние
            this.clearAllSelections();
        }
        
        // Обновляем отображение
        this.updateDisplay();
    }

    getFallbackData() {
        return {
            "separator": ", ",
            "alternativeSeparator": " | ",
            "characterLimit": 100,
            "categories": [
                {
                    "name": "Жанры",
                    "type": "standard",
                    "tags": [
                        {
                            "name": "экшен",
                            "alternative": "action",
                            "subgroup": "Основные",
                            "description": "Динамичные сцены и битвы"
                        },
                        {
                            "name": "романтика",
                            "alternative": "romance",
                            "subgroup": "Основные",
                            "description": "Истории о любви и отношениях"
                        }
                    ]
                }
            ]
        };
    }

    initializeCategories() {
        this.categories.clear();
        
        this.tagsData.categories.forEach(category => {
            const categoryData = {
                name: category.name,
                type: category.type,
                tags: new Map(),
                selectedTags: new Set(),
                orderedTags: []
            };

            category.tags.forEach(tag => {
                categoryData.tags.set(tag.name, {
                    name: tag.name,
                    alternative: tag.alternative || '',
                    subgroup: tag.subgroup || '',
                    description: tag.description || ''
                });
            });

            this.categories.set(category.name, categoryData);
        });
    }

    setupEventListeners() {
        const tagsInput = document.getElementById('tagsInput');
        const limitCheckbox = document.getElementById('limitCheckbox');

        tagsInput.addEventListener('input', () => {
            this.parseInputString(tagsInput.value);
            this.updateDisplay();
        });

        limitCheckbox.addEventListener('change', () => {
            this.updateDisplay();
        });
    }

    renderTags() {
        const container = document.getElementById('tagsContainer');
        container.innerHTML = '';

        this.categories.forEach((categoryData, categoryName) => {
            const categoryElement = this.createCategoryElement(categoryName, categoryData);
            container.appendChild(categoryElement);
        });
    }

    createCategoryElement(categoryName, categoryData) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        
        const title = document.createElement('div');
        title.className = 'category-title';
        title.textContent = categoryName;
        categoryDiv.appendChild(title);

        const subgroups = this.groupTagsBySubgroup(categoryData.tags);
        
        subgroups.forEach((tags, subgroupName) => {
            if (subgroupName) {
                const subgroupDiv = document.createElement('div');
                subgroupDiv.className = 'subgroup';
                
                const subgroupTitle = document.createElement('div');
                subgroupTitle.className = 'subgroup-title';
                subgroupTitle.textContent = subgroupName;
                subgroupDiv.appendChild(subgroupTitle);
                
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

    groupTagsBySubgroup(tagsMap) {
        const subgroups = new Map();
        
        tagsMap.forEach(tag => {
            if (!subgroups.has(tag.subgroup)) {
                subgroups.set(tag.subgroup, []);
            }
            subgroups.get(tag.subgroup).push(tag);
        });

        return subgroups;
    }

    createTagsGroup(tags, categoryName, categoryData) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'tags-group';

        tags.forEach(tag => {
            const button = document.createElement('button');
            button.className = 'tag-button';
            button.textContent = tag.name;
            
            if (tag.description) {
                button.title = tag.description;
            }

            button.addEventListener('click', () => {
                this.handleTagClick(categoryName, tag.name, categoryData.type);
            });

            groupDiv.appendChild(button);
        });

        return groupDiv;
    }

    handleTagClick(categoryName, tagName, categoryType) {
        const categoryData = this.categories.get(categoryName);
        
        if (categoryType === 'single') {
            this.handleSingleCategory(categoryData, tagName);
        } else if (categoryType === 'ordered') {
            this.handleOrderedCategory(categoryData, tagName);
        } else {
            this.handleStandardCategory(categoryData, tagName);
        }

        this.updateDisplay();
    }

    handleSingleCategory(categoryData, tagName) {
        if (categoryData.selectedTags.has(tagName)) {
            categoryData.selectedTags.delete(tagName);
            this.selectedTags.delete(tagName);
        } else {
            if (categoryData.selectedTags.size > 0) {
                const previousTag = Array.from(categoryData.selectedTags)[0];
                categoryData.selectedTags.delete(previousTag);
                this.selectedTags.delete(previousTag);
            }
            categoryData.selectedTags.add(tagName);
            this.selectedTags.set(tagName, categoryData.name);
        }
    }

    handleOrderedCategory(categoryData, tagName) {
        if (categoryData.selectedTags.has(tagName)) {
            // Удаляем тег из orderedTags и selectedTags
            const index = categoryData.orderedTags.indexOf(tagName);
            categoryData.orderedTags.splice(index, 1);
            categoryData.selectedTags.delete(tagName);
            this.selectedTags.delete(tagName);
        } else {
            // Добавляем тег в orderedTags и selectedTags
            categoryData.orderedTags.push(tagName);
            categoryData.selectedTags.add(tagName);
            this.selectedTags.set(tagName, categoryData.name);
        }
    }

    handleStandardCategory(categoryData, tagName) {
        if (categoryData.selectedTags.has(tagName)) {
            categoryData.selectedTags.delete(tagName);
            this.selectedTags.delete(tagName);
        } else {
            categoryData.selectedTags.add(tagName);
            this.selectedTags.set(tagName, categoryData.name);
        }
    }

    // Функция 1: Создание результирующей строки
    createResultString() {
        const tags = [];
        
        // Проходим по категориям в порядке из JSON
        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);
            
            if (!categoryData) return;
            
            // Для каждой категории получаем теги в правильном порядке
            if (categoryData.type === 'ordered') {
                // Для ordered категории - берем порядок из orderedTags
                tags.push(...categoryData.orderedTags);
            } else if (categoryData.type === 'single') {
                // Для single категории - берем первый выбранный тег
                if (categoryData.selectedTags.size > 0) {
                    tags.push(Array.from(categoryData.selectedTags)[0]);
                }
            } else {
                // Для standard категории - берем теги в порядке из JSON
                const categoryTagsInOrder = [];
                categoryConfig.tags.forEach(tagConfig => {
                    if (categoryData.selectedTags.has(tagConfig.name)) {
                        categoryTagsInOrder.push(tagConfig.name);
                    }
                });
                tags.push(...categoryTagsInOrder);
            }
        });

        return tags.join(this.tagsData.separator);
    }

    // Функция 2: Создание альтернативной строки
    createAlternativeString() {
        const alternativeTags = [];
        
        // Проходим по категориям в порядке из JSON
        this.tagsData.categories.forEach(categoryConfig => {
            const categoryName = categoryConfig.name;
            const categoryData = this.categories.get(categoryName);
            
            if (!categoryData) return;
            
            // Для каждой категории получаем альтернативные теги в правильном порядке
            if (categoryData.type === 'ordered') {
                // Для ordered категории - берем порядок из orderedTags
                categoryData.orderedTags.forEach(tagName => {
                    const tag = categoryData.tags.get(tagName);
                    if (tag && tag.alternative) {
                        alternativeTags.push(tag.alternative);
                    }
                });
            } else if (categoryData.type === 'single') {
                // Для single категории - берем первый выбранный тег
                if (categoryData.selectedTags.size > 0) {
                    const tagName = Array.from(categoryData.selectedTags)[0];
                    const tag = categoryData.tags.get(tagName);
                    if (tag && tag.alternative) {
                        alternativeTags.push(tag.alternative);
                    }
                }
            } else {
                // Для standard категории - берем теги в порядке из JSON
                categoryConfig.tags.forEach(tagConfig => {
                    if (categoryData.selectedTags.has(tagConfig.name)) {
                        const tag = categoryData.tags.get(tagConfig.name);
                        if (tag && tag.alternative) {
                            alternativeTags.push(tag.alternative);
                        }
                    }
                });
            }
        });

        return alternativeTags.join(this.tagsData.alternativeSeparator);
    }

    // Функция 3: Парсинг входной строки
    parseInputString(inputString) {
        this.clearAllSelections();
        
        const tags = inputString.split(this.tagsData.separator)
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

        let lastCategory = null;

        tags.forEach(tag => {
            let categoryFound = null;
            let tagFound = null;

            // Сначала ищем в той же категории, что и предыдущий тег
            if (lastCategory) {
                const category = this.categories.get(lastCategory);
                if (category && category.tags.has(tag)) {
                    categoryFound = lastCategory;
                    tagFound = tag;
                }
            }

            // Если не нашли, ищем во всех категориях
            if (!categoryFound) {
                for (const [categoryName, category] of this.categories) {
                    if (category.tags.has(tag)) {
                        categoryFound = categoryName;
                        tagFound = tag;
                        break;
                    }
                }
            }

            if (categoryFound && tagFound) {
                const category = this.categories.get(categoryFound);
                
                if (category.type === 'single') {
                    // Для single категории очищаем предыдущий выбор
                    category.selectedTags.clear();
                    category.selectedTags.add(tagFound);
                    this.selectedTags.set(tagFound, categoryFound);
                } else if (category.type === 'ordered') {
                    // Для ordered категории добавляем тег в orderedTags
                    if (!category.orderedTags.includes(tagFound)) {
                        category.orderedTags.push(tagFound);
                        category.selectedTags.add(tagFound);
                        this.selectedTags.set(tagFound, categoryFound);
                    }
                } else {
                    // Для standard категории просто добавляем тег
                    category.selectedTags.add(tagFound);
                    this.selectedTags.set(tagFound, categoryFound);
                }
                
                lastCategory = categoryFound;
            }
        });
    }

    clearAllSelections() {
        this.selectedTags.clear();
        this.categories.forEach(category => {
            category.selectedTags.clear();
            category.orderedTags = [];
        });
    }

    updateDisplay() {
        this.updateInputField();
        this.updateTagsAppearance();
        this.updateAlternativeSection();
        this.updateLimitDisplay();
    }

    updateInputField() {
        const input = document.getElementById('tagsInput');
        const resultString = this.createResultString();
        
        // Проверяем лимит
        const limitCheckbox = document.getElementById('limitCheckbox');
        const isLimitEnabled = limitCheckbox.checked;
        
        if (isLimitEnabled && resultString.length > this.tagsData.characterLimit) {
            // Откатываем изменения, если превышен лимит
            this.parseInputString(input.value);
            this.updateTagsAppearance();
        } else {
            input.value = resultString;
        }
    }

    updateTagsAppearance() {
        this.categories.forEach((categoryData, categoryName) => {
            // Находим категорию по тексту заголовка
            const categoryElements = document.querySelectorAll('.category');
            let categoryElement = null;
            
            for (const element of categoryElements) {
                const titleElement = element.querySelector('.category-title');
                if (titleElement && titleElement.textContent === categoryName) {
                    categoryElement = element;
                    break;
                }
            }
            
            if (!categoryElement) return;

            const buttons = categoryElement.querySelectorAll('.tag-button');
            
            buttons.forEach(button => {
                const tagName = button.textContent;
                const isSelected = categoryData.selectedTags.has(tagName);
                
                button.classList.toggle('selected', isSelected);
                
                if (categoryData.type === 'ordered' && isSelected) {
                    const orderIndex = categoryData.orderedTags.indexOf(tagName);
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

    updateAlternativeSection() {
        const alternativeSection = document.getElementById('alternativeSection');
        const alternativeOutput = document.getElementById('alternativeOutput');
        
        const alternativeString = this.createAlternativeString();
        
        if (alternativeString) {
            alternativeSection.classList.remove('hidden');
            alternativeOutput.value = alternativeString;
        } else {
            alternativeSection.classList.add('hidden');
        }
    }

    updateLimitDisplay() {
        const limitDisplay = document.getElementById('limitDisplay');
        const currentLength = this.createResultString().length;
        const limit = this.tagsData.characterLimit;
        
        limitDisplay.textContent = `${currentLength}/${limit}`;
        
        const limitCheckbox = document.getElementById('limitCheckbox');
        if (limitCheckbox.checked && currentLength > limit) {
            limitDisplay.classList.add('exceeded');
        } else {
            limitDisplay.classList.remove('exceeded');
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new TagsManager();
});