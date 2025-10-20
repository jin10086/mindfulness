const CACHE_NAME = 'mindfulness-audio-v1';
const STATIC_CACHE_NAME = 'mindfulness-static-v1';
const AUDIO_CACHE_NAME = 'mindfulness-audio-files-v1';

// 需要缓存的静态资源
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// 音频文件（较大，单独缓存策略）
const AUDIO_FILES = [
  './audio/rain.mp3',
  './audio/sea.mp3',
  './audio/water.mp3',
  './audio/bowl.mp3'
];

// Service Worker 安装事件
self.addEventListener('install', (event) => {
  console.log('Service Worker 安装中...');
  
  event.waitUntil(
    Promise.all([
      // 缓存静态资源
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        console.log('缓存静态资源...');
        return cache.addAll(STATIC_ASSETS);
      }),
      // 预缓存音频文件（可选，根据网络情况）
      cacheAudioFiles()
    ]).then(() => {
      console.log('Service Worker 安装完成');
      // 强制激活新的 Service Worker
      return self.skipWaiting();
    })
  );
});

// Service Worker 激活事件
self.addEventListener('activate', (event) => {
  console.log('Service Worker 激活中...');
  
  event.waitUntil(
    Promise.all([
      // 清理旧缓存
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && 
                cacheName !== AUDIO_CACHE_NAME &&
                cacheName !== CACHE_NAME) {
              console.log('删除旧缓存:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // 立即控制所有客户端
      self.clients.claim()
    ]).then(() => {
      console.log('Service Worker 激活完成');
    })
  );
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 处理音频文件请求
  if (url.pathname.includes('/audio/')) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }
  
  // 处理静态资源请求
  if (event.request.method === 'GET') {
    event.respondWith(handleStaticRequest(event.request));
  }
});

// 处理静态资源请求（缓存优先策略）
async function handleStaticRequest(request) {
  try {
    // 先从缓存中查找
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('从缓存返回:', request.url);
      return cachedResponse;
    }
    
    // 缓存中没有，从网络获取
    const networkResponse = await fetch(request);
    
    // 如果是静态资源，添加到缓存
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
      console.log('缓存新资源:', request.url);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('网络请求失败:', error);
    
    // 如果是HTML请求且网络失败，返回离线页面
    if (request.destination === 'document') {
      const cache = await caches.open(STATIC_CACHE_NAME);
      return cache.match('./index.html');
    }
    
    throw error;
  }
}

// 处理音频文件请求（网络优先，缓存备用）
async function handleAudioRequest(request) {
  try {
    // 先尝试从网络获取（确保最新版本）
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // 更新缓存
      const cache = await caches.open(AUDIO_CACHE_NAME);
      cache.put(request, networkResponse.clone());
      console.log('更新音频缓存:', request.url);
      return networkResponse;
    }
  } catch (error) {
    console.log('网络获取音频失败，尝试缓存:', error);
  }
  
  // 网络失败，从缓存获取
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    console.log('从缓存返回音频:', request.url);
    return cachedResponse;
  }
  
  // 缓存中也没有，返回错误
  throw new Error('音频文件不可用');
}

// 预缓存音频文件（智能缓存）
async function cacheAudioFiles() {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    
    // 检查网络连接类型（如果支持）
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const isSlowConnection = connection && (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g');
    
    if (isSlowConnection) {
      console.log('检测到慢速网络，跳过音频预缓存');
      return;
    }
    
    // 只缓存较小的音频文件或用户可能首先使用的文件
    const priorityAudioFiles = ['./audio/bowl.mp3']; // 钵声文件较小，优先缓存
    
    for (const audioFile of priorityAudioFiles) {
      try {
        const response = await fetch(audioFile);
        if (response.ok) {
          await cache.put(audioFile, response);
          console.log('预缓存音频文件:', audioFile);
        }
      } catch (error) {
        console.log('预缓存音频文件失败:', audioFile, error);
      }
    }
  } catch (error) {
    console.error('音频预缓存失败:', error);
  }
}

// 监听消息（用于手动缓存控制）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_AUDIO') {
    const audioUrl = event.data.url;
    cacheSpecificAudio(audioUrl).then(() => {
      event.ports[0].postMessage({ success: true });
    }).catch((error) => {
      event.ports[0].postMessage({ success: false, error: error.message });
    });
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 缓存特定音频文件
async function cacheSpecificAudio(url) {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = await fetch(url);
    
    if (response.ok) {
      await cache.put(url, response);
      console.log('手动缓存音频文件:', url);
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('手动缓存音频文件失败:', url, error);
    throw error;
  }
}