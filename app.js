// 星语小程序入口：全局登录态
App({
  globalData: {
    token: '',
    userInfo: null
  },
  onLaunch() {
    // 启动时读本地缓存的 token / 用户信息，保持登录态
    this.globalData.token = wx.getStorageSync('token') || ''
    this.globalData.userInfo = wx.getStorageSync('userInfo') || null
  }
})
