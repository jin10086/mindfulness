// Web Worker for audio processing
class AudioWorker {
  constructor() {
    this.backgroundBuffers = {};
    this.bowlBuffer = null;
  }

  async loadAudioBuffer(url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      
      // 在Worker中创建AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      audioContext.close();
      
      return audioBuffer;
    } catch (error) {
      console.error(`Failed to load audio from ${url}:`, error);
      throw error;
    }
  }

  async initializeAudio() {
    try {
      // 加载背景音频
      const backgroundFiles = {
        rain: './audio/rain.mp3',
        sea: './audio/sea.mp3',
        water: './audio/water.mp3'
      };

      for (const [key, url] of Object.entries(backgroundFiles)) {
        this.backgroundBuffers[key] = await this.loadAudioBuffer(url);
      }

      // 加载钵声
      this.bowlBuffer = await this.loadAudioBuffer('./audio/bowl.mp3');

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async synthesizeAudio(backgroundType, durationMinutes) {
    const durationSeconds = durationMinutes * 60;
    const sampleRate = 44100;
    const channels = 2;

    // 发送进度更新
    this.postProgress(20, "创建音频上下文", `准备生成 ${durationMinutes} 分钟音频`);

    // 优化：使用更小的缓冲区大小来减少内存使用
    const bufferSize = Math.min(sampleRate * durationSeconds, sampleRate * 300); // 最大5分钟缓冲区
    const needsStreaming = durationSeconds > 300; // 超过5分钟使用流式处理

    // 创建离线音频上下文
    const offlineContext = new OfflineAudioContext(
      channels,
      bufferSize,
      sampleRate
    );

    // 获取背景音buffer
    const backgroundBuffer = this.backgroundBuffers[backgroundType];
    if (!backgroundBuffer) {
      throw new Error("背景音未加载");
    }

    this.postProgress(30, "设置背景音频", "创建无缝循环背景音");

    if (needsStreaming) {
      // 对于长音频，使用分段处理
      return await this.synthesizeAudioInChunks(backgroundType, durationMinutes);
    } else {
      // 对于短音频，使用原有方法
      return await this.synthesizeAudioDirect(offlineContext, backgroundBuffer, durationMinutes);
    }
  }

  async synthesizeAudioDirect(offlineContext, backgroundBuffer, durationMinutes) {
    const durationSeconds = durationMinutes * 60;

    // 创建无缝循环的背景音
    await this.createSeamlessBackground(
      offlineContext,
      backgroundBuffer,
      durationSeconds
    );

    this.postProgress(60, "添加钵声", "计算钵声插入时间点");

    // 计算钵声插入时间点
    const bowlTimes = this.calculateBowlTimes(durationMinutes);

    // 添加钵声
    await this.addBowlSounds(offlineContext, bowlTimes);

    this.postProgress(80, "渲染音频", "正在合成最终音频文件");

    // 渲染音频
    const renderedBuffer = await offlineContext.startRendering();

    this.postProgress(95, "转换格式", "准备音频下载");

    // 转换为Blob
    return this.audioBufferToBlob(renderedBuffer);
  }

  async synthesizeAudioInChunks(backgroundType, durationMinutes) {
    const chunkDuration = 5; // 每个块5分钟
    const totalChunks = Math.ceil(durationMinutes / chunkDuration);
    const audioChunks = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunkStart = i * chunkDuration;
      const chunkEnd = Math.min((i + 1) * chunkDuration, durationMinutes);
      const actualChunkDuration = chunkEnd - chunkStart;

      this.postProgress(
        30 + (i / totalChunks) * 50,
        `处理音频块 ${i + 1}/${totalChunks}`,
        `生成第 ${chunkStart}-${chunkEnd} 分钟`
      );

      const chunkBuffer = await this.generateAudioChunk(
        backgroundType,
        actualChunkDuration,
        chunkStart
      );
      
      audioChunks.push(chunkBuffer);
    }

    this.postProgress(85, "合并音频块", "正在组合所有音频片段");

    // 合并所有音频块
    const finalBuffer = await this.mergeAudioChunks(audioChunks);

    this.postProgress(95, "转换格式", "准备音频下载");

    return this.audioBufferToBlob(finalBuffer);
  }

  async generateAudioChunk(backgroundType, durationMinutes, startOffset) {
    const durationSeconds = durationMinutes * 60;
    const sampleRate = 44100;
    const channels = 2;

    const offlineContext = new OfflineAudioContext(
      channels,
      sampleRate * durationSeconds,
      sampleRate
    );

    const backgroundBuffer = this.backgroundBuffers[backgroundType];
    
    // 创建背景音
    await this.createSeamlessBackground(offlineContext, backgroundBuffer, durationSeconds);

    // 计算这个块中的钵声时间点
    const allBowlTimes = this.calculateBowlTimes(startOffset + durationMinutes);
    const chunkBowlTimes = allBowlTimes.filter(time => 
      time >= startOffset * 60 && time < (startOffset + durationMinutes) * 60
    ).map(time => time - startOffset * 60);

    if (chunkBowlTimes.length > 0) {
      await this.addBowlSounds(offlineContext, chunkBowlTimes);
    }

    return await offlineContext.startRendering();
  }

  async mergeAudioChunks(chunks) {
    if (chunks.length === 0) return null;
    if (chunks.length === 1) return chunks[0];

    const sampleRate = chunks[0].sampleRate;
    const channels = chunks[0].numberOfChannels;
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // 创建合并后的缓冲区
    const mergedBuffer = new AudioBuffer({
      numberOfChannels: channels,
      length: totalLength,
      sampleRate: sampleRate
    });

    let offset = 0;
    for (let channel = 0; channel < channels; channel++) {
      const mergedData = mergedBuffer.getChannelData(channel);
      offset = 0;
      
      for (const chunk of chunks) {
        const chunkData = chunk.getChannelData(channel);
        mergedData.set(chunkData, offset);
        offset += chunkData.length;
      }
    }

    return mergedBuffer;
  }

  async createSeamlessBackground(context, backgroundBuffer, durationSeconds) {
    const backgroundDuration = backgroundBuffer.duration;
    const loopCount = Math.ceil(durationSeconds / backgroundDuration);
    
    // 创建主增益节点
    const gainNode = context.createGain();
    gainNode.gain.value = 0.3; // 背景音音量
    gainNode.connect(context.destination);

    // 使用多个短BufferSource而不是一个巨大的缓冲区
    for (let i = 0; i < loopCount; i++) {
      const source = context.createBufferSource();
      source.buffer = backgroundBuffer;
      
      const startTime = i * backgroundDuration;
      const endTime = Math.min((i + 1) * backgroundDuration, durationSeconds);
      
      if (startTime >= durationSeconds) break;
      
      // 连接到增益节点
      source.connect(gainNode);
      
      // 设置播放时间
      source.start(startTime);
      if (endTime < (i + 1) * backgroundDuration) {
        source.stop(endTime);
      }
      
      // 添加交叉淡化（缩短到0.1秒）
      if (i > 0) {
        const fadeTime = 0.1;
        const fadeGain = context.createGain();
        fadeGain.gain.setValueAtTime(0, startTime);
        fadeGain.gain.linearRampToValueAtTime(1, startTime + fadeTime);
        
        source.disconnect();
        source.connect(fadeGain);
        fadeGain.connect(gainNode);
      }
    }
  }

  calculateBowlTimes(durationMinutes) {
    const times = [];
    const totalSeconds = durationMinutes * 60;
    
    // 开始钵声
    times.push(5);
    
    // 中间的钵声 - 每5分钟一次
    for (let minute = 5; minute < durationMinutes - 1; minute += 5) {
      times.push(minute * 60);
    }
    
    // 结束钵声
    if (totalSeconds > 60) {
      times.push(totalSeconds - 5);
    }
    
    return times;
  }

  async addBowlSounds(context, bowlTimes) {
    if (!this.bowlBuffer) return;
    
    for (const time of bowlTimes) {
      const source = context.createBufferSource();
      source.buffer = this.bowlBuffer;
      
      const gainNode = context.createGain();
      gainNode.gain.value = 0.8;
      
      source.connect(gainNode);
      gainNode.connect(context.destination);
      
      source.start(time);
    }
  }

  audioBufferToBlob(buffer) {
    const length = buffer.length;
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    
    // 创建WAV文件
    const arrayBuffer = new ArrayBuffer(44 + length * channels * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV文件头
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * channels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * channels * 2, true);
    
    // 音频数据
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  postProgress(percentage, text, details) {
    self.postMessage({
      type: 'progress',
      data: { percentage, text, details }
    });
  }
}

// Worker消息处理
const audioWorker = new AudioWorker();

self.onmessage = async function(e) {
  const { type, data } = e.data;
  
  try {
    switch (type) {
      case 'init':
        const initResult = await audioWorker.initializeAudio();
        self.postMessage({ type: 'init-complete', data: initResult });
        break;
        
      case 'synthesize':
        const { backgroundType, durationMinutes } = data;
        const audioBlob = await audioWorker.synthesizeAudio(backgroundType, durationMinutes);
        self.postMessage({ 
          type: 'synthesis-complete', 
          data: { audioBlob }
        });
        break;
        
      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      data: { message: error.message, stack: error.stack }
    });
  }
};