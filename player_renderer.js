/* 独立玩家贴图渲染器：三方向单图，帧表可继续扩展为 8 方向动画。 */
(function (window) {
  const PF = window.PF = window.PF || {};

  class PlayerRenderer {
    constructor(options = {}) {
      this.frameWidth = options.frameWidth || 48;
      this.frameHeight = options.frameHeight || 48;
      this.sources = {
        down: 'assets/player_down.png',
        up: 'assets/player_up.png',
        right: 'assets/player_right.png'
      };
      this.images = {};
      this.flashFrames = {};
      this.loadedCount = 0;
      this.ready = false;
      this.failed = false;

      // 单图方向帧表；以后做8方向动画只需扩展帧坐标。
      this.frames = {
        down: { x: 0, y: 0, w: this.frameWidth, h: this.frameHeight },
        up: { x: 0, y: 0, w: this.frameWidth, h: this.frameHeight },
        right: { x: 0, y: 0, w: this.frameWidth, h: this.frameHeight }
      };

      Object.keys(this.sources).forEach((direction) => {
        const image = new Image();
        image.decoding = 'async';
        image.addEventListener('load', () => {
          this.images[direction] = image;
          this.buildFlashFrame(direction, image);
          this.loadedCount += 1;
          if (this.loadedCount === Object.keys(this.sources).length) {
            this.ready = true;
            this.failed = false;
          }
        });
        image.addEventListener('error', () => {
          this.failed = true;
          this.ready = false;
        });
        image.src = this.sources[direction];
      });
    }

    buildFlashFrame(direction, image) {
      const canvas = document.createElement('canvas');
      canvas.width = this.frameWidth;
      canvas.height = this.frameHeight;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        image,
        0, 0, image.naturalWidth, image.naturalHeight,
        0, 0, this.frameWidth, this.frameHeight
      );
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.frameWidth, this.frameHeight);
      ctx.globalCompositeOperation = 'source-over';
      this.flashFrames[direction] = canvas;
    }

    getFrame(direction) {
      return this.frames[direction] || this.frames.down;
    }

    draw(ctx, player, time) {
      if (!this.ready) return false;

      const requested = player.direction || 'down';
      const direction = this.frames[requested] ? requested : 'down';
      const image = this.images[direction] || this.images.down;
      if (!image) return false;

      const frame = this.getFrame(direction);
      const facing = player.facing || 1;
      const flip = direction === 'right' && facing < 0;
      const moving = player.moving;
      const bob = moving
        ? (Math.sin(player.walkTime * 14) > 0 ? 0 : -1)
        : (Math.sin(time * 2.8) > 0 ? 0 : -1);

      // 独立接地阴影。
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, .34)';
      ctx.beginPath();
      ctx.ellipse(
        Math.round(player.x), Math.round(player.y) + 12,
        12, 4, 0, 0, Math.PI * 2
      );
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(Math.round(player.x), Math.round(player.y) + bob);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(
        image,
        frame.x, frame.y, frame.w, frame.h,
        -this.frameWidth / 2, -this.frameHeight / 2,
        this.frameWidth, this.frameHeight
      );
      const flash = this.flashFrames[direction];
      if (player.hurtFlash > 0 && flash) {
        ctx.globalAlpha = 0.7;
        ctx.drawImage(
          flash,
          -this.frameWidth / 2, -this.frameHeight / 2,
          this.frameWidth, this.frameHeight
        );
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return true;
    }
  }

  PF.PlayerRendererClass = PlayerRenderer;
  PF.PlayerRenderer = new PlayerRenderer({ frameWidth: 48, frameHeight: 48 });
})(window);
