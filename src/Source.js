ThreeAudio.Source = function (fftSize, element, detectors) {
  this.fftSize = fftSize || 1024;
  this.detectors = detectors || [ThreeAudio.LevelDetect, ThreeAudio.BeatDetect];

  this.filters = {};
  this.playing = false;
  this.processingDelay = 0;

  if (!(webkitAudioContext || AudioContext)) {
    throw "Web Audio API not supported";
  }
  else {
    this.initElement(element);
  }
}

ThreeAudio.Source.prototype = {

  initElement: function (element) {
    var c = this.context = new (webkitAudioContext || AudioContext)();

    // Create source
    if (element) {
      this.element = element;
    }
    else {
      this.element = new Audio();
      this.element.preload = 'auto';
    }

    // Create buffers for time/freq data.
    this.samples = this.fftSize / 2;
    this.data = {
      // High resolution FFT for frequency / time data
      freq: new Uint8Array(this.samples),
      time: new Uint8Array(this.samples),
      // Low resolution filtered signals, time data only.
      filter: {
        bass: new Uint8Array(this.samples),
        mid: new Uint8Array(this.samples),
        treble: new Uint8Array(this.samples)//,
      }//,
    };

    // Wait for audio metadata before initializing analyzer
    if (this.element.readyState >= 3) {
      this.initAnalyzer();
    }
    else {
      this.element.addEventListener('canplay', function () {
        this.initAnalyzer();
      }.bind(this));
    }

  },

  initAnalyzer: function () {
    var c = this.context;

    this.source = c.createMediaElementSource(this.element);

    // Create main analyser
    this.analyser = c.createAnalyser();
    var fftSize = this.analyser.fftSize = this.fftSize;

    // Create filter nodes for bass/mid/treble signals.
    var parameters = {
      bass: {
        type: 0, // LOWPASS
        frequency: 160,
        Q: 1.2,
        gain: 2.0//,
      },
      mid: {
        type: 2, // BANDPASS
        frequency: 500,
        Q: 1.2,
        gain: 4.0//,
      },
      treble: {
        type: 1, //HIGHPASS
        frequency: 2000,
        Q: 1.2,
        gain: 3.0//,
      }//,
    };
    var filters = this.filters;
    _.each(parameters, function (spec, key) {
      var filter = c.createBiquadFilter();
      filter.key = key;
      filter.type = spec.type;
      filter.frequency.value = spec.frequency;
      filter.Q.value = spec.Q;

      // Create analyser for filtered signal.
      filter.analyser = c.createAnalyser();
      filter.analyser.fftSize = fftSize;

      // Create delay node to compensate for FFT lag.
      filter.delayNode = c.createDelayNode();
      filter.delayNode.delayTime.value = 0;

      // Create gain node to offset filter loss.
      filter.gainNode = c.createGainNode();
      filter.gainNode.gain.value = spec.gain;

      filters[key] = filter;
    });

    // Create playback delay to compensate for FFT lag.
    this.delay = c.createDelayNode();
    this.processingDelay = this.fftSize * 2 / c.sampleRate;
    this.delay.delayTime.value = this.processingDelay;

    // Connect main audio processing pipe
    this.source.connect(this.analyser);
    this.analyser.connect(this.delay);
    this.delay.connect(c.destination);

    // Connect secondary filters + analysers + gain.
    var source = this.source;
    _.each(filters, function (filter) {
      source.connect(filter.delayNode);
      filter.delayNode.connect(filter);
      filter.connect(filter.gainNode);
      filter.gainNode.connect(filter.analyser);
    });

    // Create detectors
    this.detectors = _.map(this.detectors, function (klass) {
      return (new klass(this.data));
    }.bind(this));
  },

  update: function () {
    var a = this.analyser, d = this.data;

    if (a) {
      // Get freq/time data.
      a.smoothingTimeConstant = 0;
      a.getByteFrequencyData(d.freq);
      a.getByteTimeDomainData(d.time);

      // Get filtered signals.
      _.each(this.filters, function (filter) {
        filter.analyser.getByteTimeDomainData(d.filter[filter.key]);
      });

      // Update detectors.
      _.each(this.detectors, function (det) {
        det.analyse();
      });
    }

    return this;
  },

  size: function () {
    return this.analyser.frequencyBinCount;
  },

  load: function (url, callback) {
    var context = this.context,
        source = this.source,
        that = this;

    var ping = function () {
      // Begin playback if requested earlier.
      if (that.playing) {
        that._play();
      }

      // Remove event listener
      that.element.removeEventListener('canplaythrough', ping);

      // Fire callback
      callback && callback();
    };

    // Add event listener for when loading is complete
    this.element.addEventListener('canplaythrough', ping);
    this.element.src = url;

    return this;
  },

  play: function () {
    this.playing = true;
    if (this.element.readyState == 4) {
      this._play();
    }
    return this;
  },

  stop: function () {
    this.playing = false;
    if (this.element.readyState == 4) {
      this._stop();
    }
    return this;
  },

  _play: function () {
    this.element.play();
  },

  _stop: function () {
    this.element.pause();
  }//,

};

// tQuery-like naming.
ThreeAudio.Source.prototype.start = ThreeAudio.Source.prototype.play;
