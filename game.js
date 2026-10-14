let socket = null;
const GAME_NAME = "HighSchoolRandomizer"; 
let currentDay = 1;
let checkedLocationCache = [];
let isLocalDebugMode = false; // Flag to trace offline emulation state

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

// Item Name Index Lookup for Log Printing Function
const itemNamesIndex = {
    5001: "Pencilcase",
    5002: "Locker Key",
    5003: "Ability to Open A Door (One time use)",
    5004: "Spare Key",
    5005: "Cheaty Pocket Pencil",
    5006: "Eraser Scraps",
    5007: "Pen With No Ink",
    5008: "Useless Highlighter"
};

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('connect-btn').addEventListener('click', handleConnectAction);
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
                    ${((socket || isLocalDebugMode) && !isChecked) ? '' : 'disabled'} onclick="checkLocation(${locationId})">
                    ${isChecked ? '✓ Attended' : 'Attend Class'}
                </button>
            </div>
        `;
    });
}

function tryUnlockKeyLocation(locationId, dayNumber) {
    if ((!socket && !isLocalDebugMode) || checkedLocationCache.includes(locationId)) return;

    if (currentInventory[5004] < 1) {
        alert("Action Locked: You need at least 1 'Spare Key' item in your Collected Inventory pool to unlock this location!");
        return;
    }

    currentInventory[5004] -= 1;
    document.getElementById('spare-key-pool-count').innerText = `x${currentInventory[5004]}`;
    
    unlockedDayKeys.push(dayNumber);
    updateKeyshelfUI();
    
    checkLocation(locationId);
    logMessage(`Consumed 1 Spare Key item to open Day ${dayNumber} Lock!`, "location-sent");
    
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
        
        btn.disabled = (!socket && !isLocalDebugMode) || alreadyChecked;
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

/**
 * Routes connection requests. Intercepts credentials matching "RedstoneWarden17"
 * to start the local simulation mode without creating network sockets.
 */
function handleConnectAction() {
    const serverInput = document.getElementById('server-url').value.trim();
    const passwordInput = document.getElementById('password').value.trim();

    // 1. Check if the user is triggering Debug Mode
    if (serverInput.includes("RedstoneWarden17") && passwordInput === "RedstoneWarden17") {
        initLocalDebugMode();
    } else {
        // 2. Only attempt a real server connection if it's NOT debug mode
        isLocalDebugMode = false;
        initConnection(serverInput);
    }
}

/**
 * Bypasses network parameters completely to emulate an active server connection.
 */
function initLocalDebugMode() {
    isLocalDebugMode = true;
    
    // Safely drop any existing socket without creating a new one
    if (socket) { 
        socket.onclose = null; // Prevent triggering accidental disconnect alerts
        socket.close(); 
        socket = null; 
    }

    logMessage("🚨 DEBUG MODE ENABLED: Emulating active server layer local-side.", "system");
    logMessage("Checking any item location will award a randomized item from your item pool.", "system");
    
    toggleUIState(true);
    updateCompletionStats();
}

function initConnection(serverInput) {
    // Automatically elevate to secure wss:// if hosted on HTTPS (like GitHub Pages)
    if (window.location.protocol === "https:" && !serverInput.startsWith('wss://')) {
        // Strip out ws:// if the user typed it manually, then prepend wss://
        let cleanInput = serverInput.replace(/^ws:\/\//, '');
        if (!cleanInput.startsWith('wss://')) {
            cleanInput = 'wss://' + cleanInput;
        }
        serverInput = cleanInput;
    } else if (!serverInput.startsWith('ws://') && !serverInput.startsWith('wss://')) {
        serverInput = 'ws://' + serverInput;
    }

    logMessage(`Connecting: ${serverInput}...`);
    try {
        socket = new WebSocket(serverInput);

        socket.onopen = () => logMessage("Network channel open.", "system");
        socket.onerror = (err) => logMessage("Connection error occurred.", "danger");
        
        socket.onmessage = (event) => {
            const packets = JSON.parse(event.data);
            packets.forEach(handlePacket);
        };

        socket.onclose = () => {
            logMessage("Disconnected.", "danger");
            toggleUIState(false);
        };
    } catch (e) {
        logMessage(`Security block or failure creating socket: ${e.message}`, "danger");
        toggleUIState(false);
    }
}

function handlePacket(packet) {
    switch (packet.cmd) {
        case 'RoomInfo':
            sendConnectPacket();
            break;
        case 'Connected':
            logMessage("Authentication approved!", "system");
            checkedLocationCache = packet.checked_locations;
            
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
                awardItemToInventory(item.item);
            });
            break;
            
        case 'PrintJSON':
            if (packet.text) logMessage(packet.text, "system");
            break;
    }
}

/**
 * Handles incoming items for both live connections and the offline sandbox emulator.
 */
function awardItemToInventory(itemId) {
    if (currentInventory.hasOwnProperty(itemId)) {
        currentInventory[itemId] += 1;
        
        const element = document.getElementById(`item-${itemId}`);
        if (element) {
            if (itemId === 5001 || itemId === 5002) {
                const capValue = Math.min(currentInventory[itemId], 10);
                element.querySelector('.item-qty').innerText = `Lv. ${capValue} / 10`;
            } else {
                element.querySelector('.item-qty').innerText = `x${currentInventory[itemId]}`;
            }
            element.classList.add('acquired');
        }
        const itemName = itemNamesIndex[itemId] || `Unknown Item #${itemId}`;
        logMessage(`Received Item: ${itemName}`, "item-received");
    }
    evaluateKeyButtonsState();
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
    status.innerText = connected ? (isLocalDebugMode ? "Status: Connected (DEBUG)" : "Status: Connected") : "Status: Disconnected";
    status.className = connected ? "connected" : "disconnected";
    
    renderClasses();
    evaluateKeyButtonsState();
    
    document.querySelectorAll('.sub-btn:not(.key-unlock-btn)').forEach(btn => {
        const id = parseInt(btn.getAttribute('data-id'));
        btn.disabled = !connected || checkedLocationCache.includes(id);
    });
}

function checkLocation(id) {
    if ((!socket && !isLocalDebugMode) || checkedLocationCache.includes(id)) return;
    
    // Live Server Pipeline
    if (socket) {
        socket.send(JSON.stringify([{ cmd: 'LocationChecks', locations: [id] }]));
    }
    
    // Offline Emulator Layer - Drops a random item from your item pool instantly
    if (isLocalDebugMode) {
        const registeredItemIds =;
        const randomItemId = registeredItemIds[Math.floor(Math.random() * registeredItemIds.length)];
        awardItemToInventory(randomItemId);
    }

    checkedLocationCache.push(id);
    
    const targetBtn = document.getElementById(`loc-${id}`);
    if (targetBtn) {
        targetBtn.disabled = true;
        if (targetBtn.classList.contains('key-unlock-btn')) {
            targetBtn.innerText = "✓ Key Obtained";
        } else {
            targetBtn.innerText = targetBtn.classList.contains('sub-btn') ? "✓ Found" : "✓ Attended";
        }
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
