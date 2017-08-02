import ApiQueueDecorator from 'api/api-queue';
import Config from 'api/config';
import Providers from 'providers/providers';
import Timer from 'api/timer';
import Storage from 'model/storage';
import SimpleModel from 'model/simplemodel';
import { INITIAL_PLAYER_STATE } from 'model/player-model';
import { SETUP_ERROR } from 'events/events';
import Events from 'utils/backbone.events';
import loadCoreBundle from 'api/core-loader';
import Promise from 'polyfills/promise';
import viewError from 'templates/error';
import css from 'utils/css';
import dom from 'utils/dom';

const ModelShim = function() {};
Object.assign(ModelShim.prototype, SimpleModel);

const CoreShim = function(originalContainer) {
    this._events = {};
    this.modelShim = new ModelShim();
    this.modelShim._qoeItem = new Timer();
    this.currentContainer =
        this.originalContainer = originalContainer;
    this.apiQueue = new ApiQueueDecorator(this, [
        // These commands require a provider instance to be available
        'load',
        'play',
        'pause',
        'seek',
        'stop',
        'playlistItem',
        'playlistNext',
        'playlistPrev',
        'next',

        // These should just update state that could be acted on later, but need to be queued given v7 model
        'setConfig',
        'setCurrentAudioTrack',
        'setCurrentCaptions',
        'setCurrentQuality',
        'setFullscreen',
        'addButton',
        'removeButton',
        'castToggle',
        'setMute',
        'setVolume',
        'setPlaybackRate',

        // These commands require the view instance to be available
        'resize',
        'setCaptions',
        'setControls',
        'setCues',
    ], () => true);
};

Object.assign(CoreShim.prototype, {
    on: Events.on,
    once: Events.once,
    off: Events.off,
    trigger: Events.trigger,
    init(options, api) {
        const model = this.modelShim;
        const storage = new Storage('jwplayer', [
            'volume',
            'mute',
            'captionLabel',
            'qualityLabel'
        ]);
        const persisted = storage && storage.getAllItems();
        model.attributes = model.attributes || {};

        // Assigning config properties to the model needs to be synchronous for chained get API methods
        const configuration = Config(options, persisted);
        Object.assign(model.attributes, configuration, INITIAL_PLAYER_STATE);

        Promise.resolve().then(() => {
            model.getProviders = function() {
                return new Providers(configuration);
            };
            return model;
        }).then(loadCoreBundle).then(CoreMixin => {
            if (!this.apiQueue) {
                // Exit if `playerDestroy` was called on CoreLoader clearing the config
                return;
            }
            const config = this.modelShim.clone();
            // Exit if embed config encountered an error
            if (config.error instanceof Error) {
                throw config.error;
            }
            // copy queued commands
            const commandQueue = this.apiQueue.queue.slice(0);
            this.apiQueue.destroy();

            // Assign CoreMixin.prototype (formerly controller) properties to this instance making api.core the controller
            Object.assign(this, CoreMixin.prototype);
            const setupPromise = this.setup(config, api, this.originalContainer, this._events, commandQueue).then(this.playerReady);
            storage.track(this._model);
            return setupPromise;
        }).catch((error) => {
            setupError(this, error);
        });
    },
    playerDestroy() {
        if (this.apiQueue) {
            this.apiQueue.destroy();
        }
        this.off();
        this._events =
            this._model =
            this.modelShim =
            this.originalContainer =
            this.apiQueue = null;
    },
    getContainer() {
        return this.originalContainer;
    },

    // These methods read from the model
    get(property) {
        return this.modelShim.get(property);
    },
    getItemQoe() {
        return this.modelShim._qoeItem;
    },
    getConfig() {
        return Object.assign({}, this.modelShim.attributes);
    },
    getCurrentCaptions() {
        return this.get('captionsIndex');
    },
    getWidth() {
        return this.get('containerWidth');
    },
    getHeight() {
        return this.get('containerHeight');
    },
    getMute() {
        return this.get('mute');
    },
    getProvider() {
        return this.get('provider');
    },
    getState() {
        return this.get('state');
    },

    // These methods require a provider
    getAudioTracks() {
        return null;
    },
    getCaptionsList() {
        return null;
    },
    getQualityLevels() {
        return null;
    },
    getVisualQuality() {
        return null;
    },
    getCurrentQuality() {
        return -1;
    },
    getCurrentAudioTrack() {
        return -1;
    },

    // These methods require the view
    getSafeRegion(/* excludeControlbar */) {
        return {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };
    },

    // Ads specific
    isBeforeComplete() {
        return false;
    },
    isBeforePlay() {
        return false;
    },
    createInstream() {
        return null;
    },
    skipAd() {},
    attachMedia() {},
    detachMedia() {
        return null; // video tag;
    }
});

function setupError(core, error) {
    let message = error.message;
    if (message.indexOf(':') === -1) {
        message = `Error loading player: ${message}`;
    }
    const errorElement = dom.createElement(viewError(core.get('id'), message));
    const width = core.get('width');
    const height = core.get('height');

    css.style(errorElement, {
        fontSize: '16px',
        backgroundColor: '#000',
        color: '#fff',
        padding: '.75em 1.5em',
        width: width.toString().indexOf('%') > 0 ? width : `${width}px`,
        height: height.toString().indexOf('%') > 0 ? height : `${height}px'`
    });

    showView(core, errorElement);

    setTimeout(() => {
        core.trigger(SETUP_ERROR, {
            message: message
        });
    });
}

export function showView(core, viewElement) {
    if (!document.body.contains(core.currentContainer)) {
        // This implies the player was removed from the DOM before setup completed
        //   or a player has been "re" setup after being removed from the DOM
        const newContainer = document.getElementById(core._model.get('id'));
        if (newContainer) {
            core.currentContainer = newContainer;
        }
    }

    if (core.currentContainer.parentElement) {
        core.currentContainer.parentElement.replaceChild(viewElement, core.currentContainer);
    }
    core.currentContainer = viewElement;
}

export default CoreShim;
