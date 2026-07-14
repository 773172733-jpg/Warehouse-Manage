Component({
  properties: {
    title: {
      type: String,
      value: '加载失败'
    },
    message: {
      type: String,
      value: '请稍后重试。'
    },
    showRetry: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    handleRetry() {
      this.triggerEvent('retry');
    }
  }
});
