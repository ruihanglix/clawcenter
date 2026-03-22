import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ClawCenter",
  description: "Central router bridging WeChat to multiple AI agents",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
  ],

  locales: {
    root: {
      label: "English",
      lang: "en",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/01-introduction" },
          { text: "API Reference", link: "/10-api-reference" },
        ],
        sidebar: [
          {
            text: "Getting Started",
            items: [
              { text: "Introduction", link: "/01-introduction" },
              { text: "Quick Start", link: "/02-quickstart" },
              { text: "WeChat Setup", link: "/03-wechat-setup" },
            ],
          },
          {
            text: "Usage",
            items: [
              { text: "Agent Configuration", link: "/04-agents" },
              { text: "Message Routing", link: "/05-routing" },
              { text: "System Commands", link: "/06-commands" },
              { text: "Web Management Panel", link: "/07-web-ui" },
            ],
          },
          {
            text: "Advanced",
            items: [
              { text: "Multi-Machine Deployment", link: "/08-multi-machine" },
              { text: "Architecture", link: "/09-architecture" },
              { text: "API Reference", link: "/10-api-reference" },
            ],
          },
        ],
      },
    },
    cn: {
      label: "简体中文",
      lang: "zh-CN",
      themeConfig: {
        nav: [
          { text: "指南", link: "/cn/01-introduction" },
          { text: "API 参考", link: "/cn/10-api-reference" },
        ],
        sidebar: [
          {
            text: "快速上手",
            items: [
              { text: "简介", link: "/cn/01-introduction" },
              { text: "快速开始", link: "/cn/02-quickstart" },
              { text: "微信配置", link: "/cn/03-wechat-setup" },
            ],
          },
          {
            text: "使用指南",
            items: [
              { text: "Agent 配置", link: "/cn/04-agents" },
              { text: "消息路由", link: "/cn/05-routing" },
              { text: "系统命令", link: "/cn/06-commands" },
              { text: "Web 管理面板", link: "/cn/07-web-ui" },
            ],
          },
          {
            text: "进阶",
            items: [
              { text: "多机器部署", link: "/cn/08-multi-machine" },
              { text: "架构设计", link: "/cn/09-architecture" },
              { text: "API 参考", link: "/cn/10-api-reference" },
            ],
          },
        ],
      },
    },
  },

  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [
      { icon: "github", link: "https://github.com/ruihanglix/clawcenter" },
    ],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: "https://github.com/ruihanglix/clawcenter/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Copyright © 2025-present ClawCenter Contributors",
    },
  },
});
