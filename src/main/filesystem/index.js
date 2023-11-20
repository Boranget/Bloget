import fs from 'fs-extra'
import path from 'path'
import { isDirectory, isFile, isSymbolicLink } from 'common/filesystem'

/**
 * Normalize the path into an absolute path and resolves the link target if needed.
 *
 * @param {string} pathname The path or link path.
 * @returns {string} Returns the absolute path and resolved link. If the link target
 *                   cannot be resolved, an empty string is returned.
 */
export const normalizeAndResolvePath = pathname => {
  if (isSymbolicLink(pathname)) {
    const absPath = path.dirname(pathname)
    const targetPath = path.resolve(absPath, fs.readlinkSync(pathname))
    if (isFile(targetPath) || isDirectory(targetPath)) {
      return path.resolve(targetPath)
    }
    console.error(`Cannot resolve link target "${pathname}" (${targetPath}).`)
    return ''
  }
  return path.resolve(pathname)
}
/**
 * 保存文件的通用接口，在这里修改文件内容保存文件后不会回显，但是确实可以修改文件内容
 * 不止是保存md文件，保存所有文件都会用这个接口
 * 或许可以在这里清除无用图片？（如果是保存所有文件的接口就不太合适）
 * @param {*} pathname 文件路径
 * @param {*} content 文件内容
 * @param {*} extension 扩展名？
 * @param {*} options 看起来是编码
 * @returns 一个Promise，保存文件的结果
 */
export const writeFile = (pathname, content, extension, options = 'utf-8') => {
  // 如果路径为空
  if (!pathname) {
    return Promise.reject(new Error('[ERROR] Cannot save file without path.'))
  }
  pathname = !extension || pathname.endsWith(extension) ? pathname : `${pathname}${extension}`

  return fs.outputFile(pathname, content, options)
}
