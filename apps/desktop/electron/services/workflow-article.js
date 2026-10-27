// @ts-check
/** workflow-article.js — 工作流条目 → 发布文章的最小映射 */

function buildArticle (item, contentType) {
  const article = {
    title: item.title || '',
    content: item.content || '',
    cover_path: item.coverImage || '',
    tags: [],
  }
  if (contentType === 'video') article.video_path = item.videoPath || ''
  return article
}

function itemKeyOf (item) {
  return String((item && (item.externalId || item.url || item.title)) || '')
}

module.exports = { buildArticle, itemKeyOf }
