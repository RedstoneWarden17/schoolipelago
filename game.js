let socket = null;
const GAME_NAME = "HighSchoolRandomizer"; 
let currentDay = 1;
let checkedLocationCache = [];

// Track collected inventory counts internally
let currentInventory = {
    5001: 0, // Progressive Pencilcase
    5002: 0, // Progressive Locker Key
    5003: 0,
    5004: 0, // Consumable Spare Key pool tracker
    5005: 0,
    5006: 0,
    5007: 0,
    5008: 0
};

// Tracks which day keys have been unlocked using the consumption rule
let unlockedDayKeys = [];

const classLocationData = {
    1: ["Environmental Science", "Product Design", "Maths", "PE", "English"],
    2: ["Food Studies", "Science", "Product Design", "Environmental Science", "Maths"],
    3: ["English", "Maths", "Product Design", "Study Hall", "Sport"],
    4: ["Product Design", "English", "Environmental Science", "Science", "Food Studies"],
    5: ["Maths", "Environmental Science", "Food Studies", "Class where you do nothing", "PE"],
    6: ["Environmental Science", "Maths", "Science", "Food Studies", "English"],
    7: ["Food Studies", "English", "Product Design", "PE", "Class where you do nothing"],
    8: ["English", "Product Design", "Maths", "Study Hall", "Sport"],
    9: ["Product Design", "Science", "Environmental Science", "English", "Food Studies"],
    10: ["Maths", "Food Studies", "PE", "Class where you do nothing", "Environmental Science"]
};

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('connect-btn').addEventListener('click', initConnection);
    renderInterface();
});

function switchDay(dayNum) {
    currentDay = dayNum;
    document.querySelectorAll('.day-tabs .tab-btn').forEach((btn, index) => {
        btn.classList.toggle('active', (index + 1) === dayNum);
    });
    renderClasses();
}

function renderInterface() {
    renderClasses();
    
    const keysContainer = document.getElementById('keys-container');
    const pencilsContainer = document.getElementById('pencils-container');
    const keyshelf = document.getElementById('unlocked-keyshelf');
    
    keysContainer.innerHTML = '';
    pencilsContainer.innerHTML = '';
    keyshelf.innerHTML = '';

    for(let d = 1; d <= 10; d++) {
        const keyId = 2000 + d;
        keysContainer.innerHTML += `<button class="location-btn sub-btn key-unlock-btn" id="loc-${keyId}" data-id="${keyId}" disabled onclick="tryUnlockKeyLocation(${keyId}, ${d})">Unlock Day ${d} Key</button>`;
        
        const pencilId = 3000 + d;
        pencilsContainer.innerHTML += `<button class="location-btn sub-btn" id="loc-${pencilId}" data-id="${pencilId}" disabled onclick="checkLocation(${pencilId})">Day ${d} Pencil</button>`;
        
        // Add inactive elements to your keyshelf display
        keyshelf.innerHTML += `<div class="shelf-key-badge locked" id="shelf-key-${d}">Day ${d} Key 🔒</div>`;
    }
    updateCompletionStats();
}

function renderClasses() {
    const container = document.getElementById('classes-container');
    container.innerHTML = '';
    
    const classes = classLocationData[currentDay];
    classes.forEach((className, index) => {
        const locationId = 1000 + ((currentDay - 1) * 5) + (index + 1);
        const isChecked = checkedLocationCache.includes(locationId);
        
        container.innerHTML += `
            <div class="class-slot-card ${isChecked ? 'completed-class' : ''}">
                <h4>Period ${index + 1}</h4>
                <p>${className}</p>
                <button class="location-btn" id="loc-${locationId}" data-id="${locationId}" 
                    ${(socket && !isChecked) ? '' : 'disabled'} onclick="checkLocation(${locationId})">
                    ${isChecked ? '✓ Attended' : 'Attend Class'}
                </button>
            </div>
        `;
    });
}

/**
 * Validates consumption rule requirements before checking key locations.
 */
function tryUnlockKeyLocation(locationId, dayNumber) {
    if (!socket || checkedLocationCache.includes(locationId)) return;

    // Enforce consumption rule check
    if (currentInventory[5004] < 1) {
        alert("Action Locked: You need at least 1 'Spare Key' item in your Collected Inventory pool to unlock this location!");
        return;
    }

    // Process logic changes client-side
    currentInventory[5004] -= 1;
    document.getElementById('spare-key-pool-count').innerText = `x${currentInventory[5004]}`;
    
    unlockedDayKeys.push(dayNumber);
    updateKeyshelfUI();
    
    // Fire checked payload to your server
    checkLocation(locationId);
    logMessage(`Consumed 1 Spare Key item to open Day ${dayNumber} Lock!`, "location-sent");
    
    // Refresh connection rules across buttons
    evaluateKeyButtonsState();
}

function updateKeyshelfUI() {
    for (let d = 1; d <= 10; d++) {
        const badge = document.getElementById(`shelf-key-${d}`);
        if (badge && unlockedDayKeys.includes(d)) {
            badge.innerText = `Day ${d} Key 🔑`;
            badge.className = "shelf-key-badge unlocked";
        }
    }
}

function evaluateKeyButtonsState() {
    document.querySelectorAll('.key-unlock-btn').forEach(btn => {
        const id = parseInt(btn.getAttribute('data-id'));
        const alreadyChecked = checkedLocationCache.includes(id);
        
        // Disable button if location is checked, or if player has no keys left
        btn.disabled = !socket || alreadyChecked;
        if (alreadyChecked) {
            btn.innerText = "✓ Key Obtained";
        }
    });
}

function updateCompletionStats() {
    const totalLocations = 70;
    const totalChecked = checkedLocationCache.length;
    const percentage = totalLocations > 0 ? Math.floor((totalChecked / totalLocations) * 100) : 0;
    document.getElementById('completion-stats').innerText = `Checked: ${totalChecked} / ${totalLocations} (${percentage}%)`;
}

function initConnection() {
    let serverInput = document.getElementById('server-url').value.trim();
    if (!serverInput.startsWith('ws://') && !serverInput.startsWith('wss://')) {
        serverInput = 'ws://' + serverInput;
    }

    logMessage(`Connecting: ${serverInput}...`);
    socket = new WebSocket(serverInput);

    socket.onopen = () => logMessage("Network channel open.", "system");
    socket.onerror = (err) => logMessage("Connection error.", "danger");
    
    socket.onmessage = (event) => {
        const packets = JSON.parse(event.data);
        packets.forEach(handlePacket);
    };

    socket.onclose = () => {
        logMessage("Disconnected.", "danger");
        toggleUIState(false);
    };
}

function handlePacket(packet) {
    switch (packet.cmd) {
        case 'RoomInfo':
            sendConnectPacket();
            break;
        case 'Connected':
            logMessage("Authentication approved!", "system");
            checkedLocationCache = packet.checked_locations;
            
            // Build key maps based on pre-cleared coordinates
            unlockedDayKeys = [];
            for(let d=1; d<=10; d++) {
                if(checkedLocationCache.includes(2000 + d)) unlockedDayKeys.push(d);
            }
            
            toggleUIState(true);
            syncCheckedUI();
            updateKeyshelfUI();
            updateCompletionStats();
            break;
            
        case 'ReceivedItems':
            packet.items.forEach(item => {
                const itemId = item.item;
                if (currentInventory.hasOwnProperty(itemId)) {
                    currentInventory[itemId] += 1;
                    
                    const element = document.getElementById(`item-${itemId}`);
                    if (element) {
                        // Handle progressive tier elements vs simple quantity stacks
                        if (itemId === 5001 || itemId === 5002) {
                            const capValue = Math.min(currentInventory[itemId], 10);
                            element.querySelector('.item-qty').innerText = `Lv. ${capValue} / 10`;
                        } else {
                            element.querySelector('.item-qty').innerText = `x${currentInventory[itemId]}`;
                        }
                        element.classList.add('acquired');
                    }
                }
            });
            // Update button states if key item count changes
            evaluateKeyButtonsState();
            break;
            
        case 'PrintJSON':
            if (packet.text) logMessage(packet.text, "system");
            break;
    }
}

function sendConnectPacket() {
    const slotName = document.getElementById('slot-name').value.trim();
    const password = document.getElementById('password').value;

    socket.send(JSON.stringify([{
        cmd: 'Connect',
        game: GAME_NAME,
        name: slotName,
        password: password,
        version: { major: 0, minor: 5, build: 0, class: "Version" },
        tags: ['AP'],
        items_handling: 7
    }]));
}

function toggleUIState(connected) {
    const status = document.getElementById('status-text');
    status.innerText = connected ? "Status: Connected" : "Status: Disconnected";
    status.className = connected ? "connected" : "disconnected";
    
    renderClasses();
    evaluateKeyButtonsState();
    
    document.querySelectorAll('.sub-btn:not(.key-unlock-btn)').forEach(btn => {
        const id = parseInt(btn.getAttribute('data-id'));
        btn.disabled = !connected || checkedLocationCache.includes(id);
    });
}

function checkLocation(id) {
    if (!socket || checkedLocationCache.includes(id)) return;
    
    socket.send(JSON.stringify([{ cmd: 'LocationChecks', locations: [id] }]));
    checkedLocationCache.push(id);
    
    const targetBtn = document.getElementById(`loc-${id}`);
    if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.innerText = targetBtn.classList.contains('sub-btn') ? "✓ Found" : "✓ Attended";
    }
    updateCompletionStats();
}

function syncCheckedUI() {
    checkedLocationCache.forEach(id => {
        const btn = document.getElementById(`loc-${id}`);
        if (btn) {
            btn.disabled = true;
            if (btn.classList.contains('key-unlock-btn')) {
                btn.innerText = "✓ Key Obtained";
            } else {
                btn.innerText = btn.classList.contains('sub-btn') ? "✓ Found" : "✓ Attended";
            }
        }
    });
}

function logMessage(text, type = 'system') {
    const log = document.getElementById('game-log');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerText = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}
