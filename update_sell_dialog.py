with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''/**
 * Диалог продажи стека: выбор количества + превью цены
 * @param {Object} item - предмет
 * @param {number} amount - всего в стеке
 * @param {number} unitPrice - цена за 1 шт.
 */
function showStackSellDialog(item, amount, unitPrice) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const message = document.getElementById('modal-message');
    if (!modal || !title || !message) {
        sellItem(item.index);
        return;
    }

    title.textContent = `Продать: ${item.name || 'предмет'}`;
    message.textContent = `В стопке ${amount} шт. по ${unitPrice} \uD83D\uDD19. Сколько продать?`;
    openModalElement(modal);

    const close = hideModal;
    const actions = [
        { label: `Продать 1 шт. (+${unitPrice} \uD83D\uDD19)`, onClick: () => sellItem(item.index, 1) },
        { label: `Продать всё (+${unitPrice * amount} \uD83D\uDD19)`, onClick: () => sellItem(item.index, amount) },
        { label: 'Отмена', onClick: () => {} }
    ];

    const box = document.createElement('div');
    box.className = 'modal-actions';
    for (const action of actions) {
        const button = document.createElement('button');
        button.className = 'modal-action-btn';
        button.textContent = action.label;
        bindClickOnce(button, `sell-stack-${item.index}-${action.label}`, () => {
            close();
            action.onClick();
        });
        box.appendChild(button);
    }
    message.appendChild(box);
}'''

new = '''/**
 * Диалог продажи стека: выбор количества + превью цены
 * @param {Object} item - предмет
 * @param {number} amount - всего в стеке
 * @param {number} unitPrice - цена за 1 шт.
 */
function showStackSellDialog(item, amount, unitPrice) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const message = document.getElementById('modal-message');
    if (!modal || !title || !message) {
        sellItem(item.index);
        return;
    }

    title.textContent = `\uD83D\uDCB0 Продажа: ${escapeHtml(item.name || '\u043F\u0440\u0435\u0434\u043C\u0435\u0442')}`;
    
    // Создаем контент с полем ввода количества
    message.innerHTML = `
        <div class="sell-dialog">
            <p class="sell-dialog-info">В стопке <strong>${amount}</strong> шт. по <strong>${unitPrice} \uD83D\uDD19</strong> за шт.</p>
            <div class="sell-dialog-quantity">
                <label for="sell-quantity">\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E:</label>
                <input type="number" id="sell-quantity" class="sell-quantity-input" 
                       value="1" min="1" max="${amount}" step="1">
                <div class="sell-quantity-buttons">
                    <button type="button" class="btn-sell-qty" data-action="min">1</button>
                    <button type="button" class="btn-sell-qty" data-action="half">${Math.floor(amount / 2)}</button>
                    <button type="button" class="btn-sell-qty" data-action="max">${amount}</button>
                </div>
            </div>
            <div class="sell-dialog-preview">
                <span>\u0418\u0442\u043E\u0433\u043E: </span>
                <strong id="sell-total-price">${unitPrice} \uD83D\uDD19</strong>
            </div>
        </div>
    `;
    
    openModalElement(modal);
    
    // Обработчики для кнопок количества
    const quantityInput = document.getElementById('sell-quantity');
    const totalPriceEl = document.getElementById('sell-total-price');
    
    const updatePreview = () => {
        let qty = parseInt(quantityInput.value, 10) || 1;
        qty = Math.max(1, Math.min(amount, qty));
        quantityInput.value = qty;
        totalPriceEl.textContent = `${unitPrice * qty} \uD83D\uDD19`;
    };
    
    quantityInput.addEventListener('input', updatePreview);
    quantityInput.addEventListener('change', updatePreview);
    
    message.querySelectorAll('.btn-sell-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'min') quantityInput.value = 1;
            else if (action === 'half') quantityInput.value = Math.floor(amount / 2);
            else if (action === 'max') quantityInput.value = amount;
            updatePreview();
        });
    });
    
    // Кнопки действий
    const actions = [
        { label: '\u041E\u0442\u043C\u0435\u043D\u0430', class: 'modal-action-btn secondary', onClick: () => hideModal() },
        { label: '\u041F\u0440\u043E\u0434\u0430\u0442\u044C', class: 'modal-action-btn primary', onClick: () => {
            const qty = parseInt(quantityInput.value, 10) || 1;
            const qty = Math.max(1, Math.min(amount, qty));
            hideModal();
            sellItem(item.index, qty);
        }}
    ];
    
    const box = document.createElement('div');
    box.className = 'modal-actions';
    box.style.marginTop = '16px';
    for (const action of actions) {
        const button = document.createElement('button');
        button.className = `modal-action-btn ${action.class || ''}`;
        button.textContent = action.label;
        bindClickOnce(button, `sell-stack-${item.index}-${action.label}`, () => {
            hideModal();
            action.onClick();
        });
        box.appendChild(button);
    }
    message.appendChild(box);
    
    // Фокус на инпут
    setTimeout(() => quantityInput?.focus(), 100);
}'''

if old in content:
    content = content.replace(old, new)
    with open(r'E:\zztelegramLast-hearth\last-hearth\public\game.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: Updated showStackSellDialog')
else:
    print('NOT FOUND: Old string not found')
    # Try to find similar
    idx = content.find('function showStackSellDialog')
    if idx >= 0:
        print('Found at:', idx)
        print(content[idx:idx+200])