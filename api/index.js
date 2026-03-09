const { Telegraf } = require('telegraf');
const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // for prompts
const express = require('express');

const app = express();
app.use(express.json());

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN || '8321486632:AAF5vfg0vnIUIlVOLvK1q9cVlK0MRuNgNRI';
const API_ID = parseInt(process.env.API_ID || '25516423');
const API_HASH = process.env.API_HASH || 'a86a8202eeb28dd33f3c4d8b5daba3cc';
const SESSION_STRING = process.env.SESSION_STRING || ''; // Save session after first run

let client = null;
let bot = null;
const startTime = Date.now();

// Initialize Telegram Client
async function initClient() {
    try {
        console.log('⏳ Connecting to Telegram...');
        
        const stringSession = new StringSession(SESSION_STRING);
        
        client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
            baseRetryDelay: 2000,
            maxRetries: 10,
            timeout: 30000
        });

        await client.start({
            botAuthToken: BOT_TOKEN,
            onError: (err) => {
                console.error('Client start error:', err);
            }
        });

        console.log('✅ Telegram Client Ready!');
        
        // Save session string for next time
        const savedSession = client.session.save();
        console.log('Session String (save this):', savedSession);
        
        return client;
    } catch (error) {
        console.error('❌ Failed to initialize client:', error);
        throw error;
    }
}

// Get user details function
async function getUserDetails(username) {
    try {
        // Clean username
        username = username.replace('@', '');
        
        // Get entity
        const entity = await client.getEntity(username);
        
        // Get full user info
        const fullUser = await client.invoke(
            new Api.users.GetFullUser({
                id: entity
            })
        );

        // Basic info
        const result = {
            success: true,
            username: entity.username ? `@${entity.username}` : null,
            user_id: entity.id.toString(),
            access_hash: entity.accessHash,
            first_name: entity.firstName || 'N/A',
            last_name: entity.lastName || 'N/A',
            phone: entity.phone || 'N/A',
            is_bot: entity.bot || false,
            is_verified: entity.verified || false,
            is_scam: entity.scam || false,
            is_fake: entity.fake || false,
            is_support: entity.support || false,
            mutual_contact: entity.mutualContact || false,
        };

        // Bio and extra details
        if (fullUser && fullUser.fullUser) {
            result.bio = fullUser.fullUser.about || 'N/A';
            result.common_chats_count = fullUser.fullUser.commonChatsCount || 0;
            
            // Profile photo
            if (fullUser.fullUser.profilePhoto) {
                result.photo_id = fullUser.fullUser.profilePhoto.id.toString();
                result.has_photo = true;
                
                // Photo details
                result.photo_details = {
                    photo_id: fullUser.fullUser.profilePhoto.id.toString(),
                    dc_id: fullUser.fullUser.profilePhoto.dcId,
                    has_video: fullUser.fullUser.profilePhoto.hasVideo || false,
                    size: fullUser.fullUser.profilePhoto.size || 0
                };
            } else {
                result.has_photo = false;
            }
        }

        // Status
        if (entity.status) {
            const statusType = entity.status.className;
            result.status = statusType;
            
            // Detailed status
            if (statusType.includes('UserStatusOnline')) {
                result.status_details = {
                    currently: 'Online',
                    expires: entity.status.expires ? new Date(entity.status.expires * 1000).toISOString() : null
                };
            } else if (statusType.includes('UserStatusOffline')) {
                result.status_details = {
                    currently: 'Offline',
                    last_seen: entity.status.wasOnline ? new Date(entity.status.wasOnline * 1000).toISOString() : null
                };
                
                // Calculate relative time
                if (entity.status.wasOnline) {
                    const diff = Math.floor((Date.now() / 1000) - entity.status.wasOnline);
                    if (diff < 60) result.status_details.last_seen_text = 'Just now';
                    else if (diff < 3600) result.status_details.last_seen_text = `${Math.floor(diff/60)} minutes ago`;
                    else if (diff < 86400) result.status_details.last_seen_text = `${Math.floor(diff/3600)} hours ago`;
                    else result.status_details.last_seen_text = `${Math.floor(diff/86400)} days ago`;
                }
            } else {
                result.status_details = {
                    currently: statusType.replace('UserStatus', ''),
                    last_seen_text: statusType.replace('UserStatus', 'Last seen ')
                };
            }
        }

        return result;
    } catch (error) {
        console.error('Error getting user details:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Advanced user details
async function getAdvancedDetails(username) {
    try {
        const basic = await getUserDetails(username);
        if (!basic.success) return basic;

        // Add advanced fields
        const result = {
            ...basic,
            account_type: {
                is_bot: basic.is_bot,
                is_verified: basic.is_verified,
                is_premium: basic.is_premium || false,
                is_scam: basic.is_scam,
                is_fake: basic.is_fake,
                is_support: basic.is_support
            },
            analysis: {
                account_score: 100,
                warnings: [],
                notes: []
            }
        };

        // Calculate score
        let score = 100;
        
        if (result.is_scam) {
            score -= 50;
            result.analysis.warnings.push('⚠️ This account is marked as SCAM');
        }
        if (result.is_fake) {
            score -= 40;
            result.analysis.warnings.push('⚠️ This account may be FAKE');
        }
        if (!result.username) {
            score -= 10;
            result.analysis.notes.push('No username set');
        }
        if (!result.bio || result.bio === 'N/A') {
            score -= 5;
            result.analysis.notes.push('No bio available');
        }
        if (result.is_verified) {
            score += 25;
            result.analysis.notes.push('✅ Verified account');
        }
        if (result.has_photo) {
            score += 10;
            result.analysis.notes.push('Has profile photo');
        }
        
        result.analysis.account_score = Math.max(0, Math.min(100, score));

        return result;
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Initialize client on module load
let initPromise = null;

async function ensureClient() {
    if (client && client.connected) {
        return client;
    }
    
    if (!initPromise) {
        initPromise = initClient();
    }
    
    return initPromise;
}

// Routes
app.get('/', async (req, res) => {
    const uptime = (Date.now() - startTime) / 1000;
    
    res.json({
        status: client && client.connected ? 'running' : 'starting',
        uptime: `${uptime.toFixed(2)} seconds`,
        version: '2.0 JavaScript',
        endpoints: {
            '/id/:username': 'Basic ID only',
            '/details/:username': 'ORIGINAL - Basic details with phone',
            '/full/:username': 'Everything available',
            '/advanced/:username': 'Complete user details with analysis',
            '/status/:username': 'Only online/offline status',
        }
    });
});

app.get('/id/:username', async (req, res) => {
    try {
        await ensureClient();
        
        let username = req.params.username;
        if (!username.startsWith('@')) username = '@' + username;
        
        const entity = await client.getEntity(username);
        
        res.json({
            success: true,
            username: entity.username ? `@${entity.username}` : null,
            chat_id: entity.id.toString(),
            type: entity.className
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/details/:username', async (req, res) => {
    try {
        await ensureClient();
        
        let username = req.params.username;
        if (!username.startsWith('@')) username = '@' + username;
        
        const result = await getUserDetails(username);
        res.json(result);
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/full/:username', async (req, res) => {
    try {
        await ensureClient();
        
        let username = req.params.username;
        if (!username.startsWith('@')) username = '@' + username;
        
        username = username.replace('@', '');
        const entity = await client.getEntity(username);
        const fullUser = await client.invoke(
            new Api.users.GetFullUser({
                id: entity
            })
        );
        
        res.json({
            entity: entity,
            full_user: fullUser
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/advanced/:username', async (req, res) => {
    try {
        await ensureClient();
        
        let username = req.params.username;
        if (!username.startsWith('@')) username = '@' + username;
        
        const result = await getAdvancedDetails(username);
        res.json(result);
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/status/:username', async (req, res) => {
    try {
        await ensureClient();
        
        let username = req.params.username;
        if (!username.startsWith('@')) username = '@' + username;
        
        const entity = await client.getEntity(username);
        
        if (entity.status) {
            res.json({
                success: true,
                username: username,
                status_type: entity.status.className,
                details: entity.status
            });
        } else {
            res.json({
                success: true,
                status: 'No status info'
            });
        }
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
});

// For Vercel serverless
module.exports = app;

// For local development
if (require.main === module) {
    const port = process.env.PORT || 8000;
    
    ensureClient().then(() => {
        app.listen(port, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(60));
            console.log('🚀 ADVANCED TELEGRAM API (JavaScript)');
            console.log(`📍 Port: ${port}`);
            console.log('='.repeat(60));
            console.log('\n📡 ENDPOINTS:');
            console.log('   • /id/@username - Sirf ID');
            console.log('   • /details/@username - 📱 Basic details');
            console.log('   • /full/@username - Raw data');
            console.log('   • /advanced/@username - Complete analysis');
            console.log('   • /status/@username - Online status');
            console.log('='.repeat(60) + '\n');
        });
    }).catch(console.error);
}
