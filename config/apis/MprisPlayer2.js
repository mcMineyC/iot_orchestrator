import dbus from "dbus-next";
import { EventEmitter } from 'events';

const MPRIS_IFACE = 'org.mpris.MediaPlayer2.Player';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

class MprisPlayer2 extends EventEmitter {
  /**
   * @param {string} [serviceName='org.mpris.MediaPlayer2.spotify'] - The DBus service name.
   * @param {string} [objectPath='/org/mpris/MediaPlayer2'] - The object path of the player.
   */
  constructor(serviceName = 'org.mpris.MediaPlayer2.spotify', objectPath = '/org/mpris/MediaPlayer2') {
    super();
    this.serviceName = serviceName;
    this.objectPath = objectPath;
    this.bus = dbus.sessionBus();
    this._initialized = false;
    this.metadata = {};         // Store the current metadata here.
    this.playbackStatus = '';    // Store the current playback state.
    //this.init(); // require async init
  }

  async init() {
    try {
      // Get the proxy object (this triggers introspection)
      this.proxyObject = await this.bus.getProxyObject(this.serviceName, this.objectPath);
      // Get the Player interface (for control methods) and the Properties interface (to read properties and watch changes)
      this.player = this.proxyObject.getInterface('org.mpris.MediaPlayer2.Player');
      this.properties = this.proxyObject.getInterface('org.freedesktop.DBus.Properties');

      // Listen for property changes; specifically, watch the "Position", "Metadata" and "PlaybackStatus" properties
      this.properties.on('PropertiesChanged', (iface, changed, invalidated) => {
        if (iface === 'org.mpris.MediaPlayer2.Player') {
          //console.log(changed);
          // Update position
          if (changed.Position) {
            // MPRIS provides Position in microseconds, so convert to milliseconds.
            this.positionMs = Number(changed.Position.value) / 1000;
            this.emit('positionChanged', this.positionMs);
          }
          // Update metadata if changed
          if (changed.Metadata) {
            // The Metadata property is a dictionary.
            this.metadata = this.mapMetadata(changed.Metadata.value);
            this.emit('metadataChanged', this.metadata);
          }
          // Update playback status if changed
          if (changed.PlaybackStatus) {
            this.playbackStatus = changed.PlaybackStatus.value;
            this.emit('playbackStateChanged', this.playbackStatus);
          }
        }
      });
      setInterval(async () => {
        try {
          const posVariant = await this.properties.Get('org.mpris.MediaPlayer2.Player', 'Position');
          const newPositionMs = Number(posVariant.value) / 1000;
          if (this.lastPosition !== newPositionMs) {
            this.lastPosition = newPositionMs;
            this.emit('positionChanged', newPositionMs);
          }
        } catch (err) {
          console.error('Error polling position:', err);
        }
      }, 500);


      this._initialized = true;
      console.log(`MprisPlayer2 initialized for service: ${this.serviceName}`);
    } catch (err) {
      console.error('Failed to initialize MprisPlayer2:', err);
      setTimeout(this.init, 1500);
    }
  }

  async play() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      await this.player.Play();
    } catch (err) {
      console.error('Play error:', err);
    }
  }

  async pause() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      await this.player.Pause();
    } catch (err) {
      console.error('Pause error:', err);
    }
  }

  async next() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      await this.player.Next();
    } catch (err) {
      console.error('Next error:', err);
    }
  }

  async previous() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      await this.player.Previous();
    } catch (err) {
      console.error('Previous error:', err);
    }
  }

  async getMetadata() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      let metadata = await this.properties.Get(MPRIS_IFACE, 'Metadata');
      this.metadata = this.mapMetadata(metadata.value);
      return this.metadata;
    } catch (err) {
      console.error('GetMetadata error:', err);
    }
  }

  async getPlaybackStatus() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      let playbackStatus = await this.properties.Get(MPRIS_IFACE, 'PlaybackStatus');
      this.playbackStatus = playbackStatus.value;
      return this.playbackStatus;
    } catch (err) {
      console.error('GetPlaybackStatus error:', err);
    }
  }

  async getPosition() {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      let position = await this.properties.Get(MPRIS_IFACE, 'Position');
      if (position.value.toString() == "null") this.positionMs = 0;
      else {
        const positionMs = Number(position.value) / 1000;
        this.position = positionMs;
      }
      return this.position;
    } catch (err) {
      console.error('GetPosition error:', err);
    }
  }

  /**
   * Sets the playback position to the given absolute position in milliseconds.
   * Internally, this converts the value to microseconds and calls the SetPosition method.
   */
  async seek(positionMs) {
    if (!this._initialized) throw Error('Player not initialized.');
    try {
      // Convert from milliseconds to microseconds.
      const positionMicro = BigInt(positionMs * 1000);

      // Retrieve the current metadata.
      const metadataVariant = await this.properties.Get('org.mpris.MediaPlayer2.Player', 'Metadata');
      const metadata = metadataVariant.value;
      const trackVariant = metadata['mpris:trackid'];

      // Extract the actual track id string from the Variant.
      const trackId =
        typeof trackVariant === 'object' && trackVariant.value
          ? trackVariant.value
          : trackVariant;

      if (!trackId) {
        throw new Error('TrackID not available in Metadata');
      }

      // Call SetPosition with the trackId and desired position.
      await this.player.SetPosition(trackId, positionMicro);
    } catch (err) {
      console.error('Seek error:', err);
    }
  }

  mapMetadata(metadata) {
    // This function maps the metadata to a more readable format.
    return {
      title: metadata['xesam:title'].value.toString(),
      album: metadata['xesam:album'].value.toString(),
      artist: metadata['xesam:artist'].value.join(', ').toString(),
      imageUrl: metadata['mpris:artUrl'].value.toString(),
      length: {value: Number(metadata['mpris:length'].value) / 1000000, unit: 's'},
      trackId: metadata['mpris:trackid'].value.split("/")[4].toString(),
    }
  }
}

export default MprisPlayer2;
