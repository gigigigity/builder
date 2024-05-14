/**
 * @file class Project
 * @desc Object-model definition for Project
 */

import { reactive, watch } from 'vue'

import { join } from '@/utils/path'
import { debounce } from '@/utils/utils'
import { IsPublic, type ProjectData } from '@/apis/project'
import { Disposble } from './common/disposable'
import { toConfig, type Files, fromConfig } from './common/file'
import { Stage, type RawStageConfig } from './stage'
import { Sprite } from './sprite'
import { Sound } from './sound'
import * as cloudHelper from './common/cloud'
import * as localHelper from './common/local'
import * as gbpHelper from './common/gbp'
import { assign } from './common'
import { ensureValidSpriteName, ensureValidSoundName } from './common/asset'

export type Metadata = {
  id?: string
  owner?: string
  name?: string
  isPublic?: IsPublic
  version?: number
  cTime?: string
  uTime?: string
  hasUnsyncedChanges?: boolean
}

const projectConfigFileName = 'index.json'
const projectConfigFilePath = join('assets', projectConfigFileName)

type RawProjectConfig = RawStageConfig & {
  // TODO: support other types in zorder
  zorder?: string[]
  // TODO: camera
}

export class Project extends Disposble {
  id?: string
  owner?: string
  name?: string
  isPublic?: IsPublic
  version = 0
  cTime?: string
  uTime?: string

  hasUnsyncedChanges = false

  stage: Stage
  sprites: Sprite[]
  sounds: Sound[]
  zorder: string[]

  removeSprite(name: string) {
    const idx = this.sprites.findIndex((s) => s.name === name)
    const [sprite] = this.sprites.splice(idx, 1)
    sprite.dispose()
  }
  /**
   * Add given sprite to project.
   * Note: the sprite's name may be altered to avoid conflict
   */
  addSprite(sprite: Sprite) {
    const newName = ensureValidSpriteName(sprite.name, this)
    sprite.setName(newName)
    sprite.setProject(this)
    this.sprites.push(sprite)
    // add to zorder
    if (!this.zorder.includes(sprite.name)) {
      this.zorder = [...this.zorder, sprite.name]
    }
    // update zorder when sprite renaming
    sprite.addDisposer(
      watch(
        () => sprite.name,
        (newName, originalName) => {
          this.zorder = this.zorder.map((v) => (v === originalName ? newName : v))
        }
      )
    )
    // update zorder when sprite deleted
    sprite.addDisposer(() => {
      this.zorder = this.zorder.filter((v) => v !== sprite.name)
    })
  }
  setSpriteZorderIdx(name: string, newIdx: number | ((idx: number, length: number) => number)) {
    const idx = this.zorder.findIndex((v) => v === name)
    if (idx < 0) throw new Error(`sprite ${name} not found in zorder`)
    const newIdxVal = typeof newIdx === 'function' ? newIdx(idx, this.zorder.length) : newIdx
    const newZorder = this.zorder.filter((v) => v !== name)
    newZorder.splice(newIdxVal, 0, name)
    this.zorder = newZorder
  }
  upSpriteZorder(name: string) {
    this.setSpriteZorderIdx(name, (i, len) => Math.min(i + 1, len - 1))
  }
  downSpriteZorder(name: string) {
    this.setSpriteZorderIdx(name, (i) => Math.max(i - 1, 0))
  }
  topSpriteZorder(name: string) {
    this.setSpriteZorderIdx(name, (_, len) => len - 1)
  }
  bottomSpriteZorder(name: string) {
    this.setSpriteZorderIdx(name, 0)
  }

  removeSound(name: string) {
    const idx = this.sounds.findIndex((s) => s.name === name)
    const [sound] = this.sounds.splice(idx, 1)
    sound.setProject(null)
  }
  /**
   * Add given sound to project.
   * Note: the sound's name may be altered to avoid conflict
   */
  addSound(sound: Sound) {
    const newName = ensureValidSoundName(sound.name, this)
    sound.setName(newName)
    sound.setProject(this)
    this.sounds.push(sound)
  }

  setPublic(isPublic: IsPublic) {
    this.isPublic = isPublic
  }

  constructor() {
    super()
    this.zorder = []
    this.stage = new Stage()
    this.sprites = []
    this.sounds = []
    this.addDisposer(() => {
      for (const sprite of this.sprites) {
        sprite.dispose()
      }
    })
    return reactive(this) as this
  }

  applyMetadata(metadata: Metadata) {
    assign<Project>(this, metadata)
  }

  /** Load with metadata & files */
  async load(metadata: Metadata, files: Files) {
    const configFile = files[projectConfigFilePath]
    const config: RawProjectConfig = {}
    if (configFile != null) {
      Object.assign(config, await toConfig(configFile))
    }
    const { zorder, ...stageConfig } = config
    const [stage, sounds, sprites] = await Promise.all([
      Stage.load(stageConfig, files),
      Sound.loadAll(files),
      Sprite.loadAll(files)
    ])
    this.applyMetadata(metadata)
    this.zorder = zorder ?? []
    this.stage = stage
    this.sprites = []
    sprites.forEach((s) => this.addSprite(s))
    this.sounds = []
    sounds.forEach((s) => this.addSound(s))
  }

  /** Export metadata & files without revision state
   * (version, cTime, uTime, hasUnsyncedChanges).
   * States version, cTime and uTime are updated after syncing to cloud
   * by the server, which are not supposed to trigger unsynced changes
   * watcher.
   */
  private exportWithoutRevisionState(): [Metadata, Files] {
    const metadata: Metadata = {
      id: this.id,
      owner: this.owner,
      name: this.name,
      isPublic: this.isPublic
    }
    const files: Files = {}
    const [stageConfig, stageFiles] = this.stage.export()
    const config: RawProjectConfig = { ...stageConfig, zorder: this.zorder }
    files[projectConfigFilePath] = fromConfig(projectConfigFileName, config)
    Object.assign(files, stageFiles)
    Object.assign(files, ...this.sprites.map((s) => s.export()))
    Object.assign(files, ...this.sounds.map((s) => s.export()))
    return [metadata, files]
  }

  /** Export metadata & files */
  export(): [Metadata, Files] {
    const [metadata, files] = this.exportWithoutRevisionState()
    metadata.version = this.version
    metadata.cTime = this.cTime
    metadata.uTime = this.uTime
    metadata.hasUnsyncedChanges = this.hasUnsyncedChanges
    return [metadata, files]
  }

  async loadGbpFile(file: globalThis.File) {
    const { metadata, files } = await gbpHelper.load(file)
    this.load(
      {
        // name is the only metadata we need when load from file
        name: this.name ?? metadata.name
      },
      files
    )
  }

  async exportGbpFile() {
    const [metadata, files] = this.export()
    return await gbpHelper.save(metadata, files)
  }

  // TODO: Some go+-builder-specific file format (instead of zip) support?

  /** Load from cloud */
  async loadFromCloud(owner: string, name: string): Promise<void>
  async loadFromCloud(projectData: ProjectData): Promise<void>
  async loadFromCloud(ownerOrProjectData: string | ProjectData, name?: string) {
    const { metadata, files } =
      typeof ownerOrProjectData === 'string'
        ? await cloudHelper.load(ownerOrProjectData, name!)
        : await cloudHelper.parseProjectData(ownerOrProjectData)
    await this.load(metadata, files)
  }

  /** Save to cloud */
  async saveToCloud() {
    const [metadata, files] = this.export()
    const res = await cloudHelper.save(metadata, files)
    this.applyMetadata(res.metadata)
    this.hasUnsyncedChanges = false
  }

  /** Load from local cache */
  async loadFromLocalCache(key: string) {
    const cached = await localHelper.load(key)
    if (cached == null) throw new Error('no project in local cache')
    const { metadata, files } = cached
    await this.load(metadata, files)
  }

  /** Sync to local cache */
  startWatchToSyncLocalCache(key: string) {
    const saveExports = debounce(() => {
      const [metadata, files] = this.export()
      localHelper.save(key, metadata, files)
    }, 1000)
    this.addDisposer(watch(() => this.export(), saveExports, { immediate: true }))
  }

  /** Should be called before `startWatchToSyncLocalCache()` */
  startWatchToSetHasUnsyncedChanges() {
    this.addDisposer(
      watch(
        () => this.exportWithoutRevisionState(),
        () => {
          this.hasUnsyncedChanges = true
        }
      )
    )
  }
}

/** Get full name for project, which stands for a globally unique identifier for the project */
export function fullName(owner: string, name: string) {
  return `${owner}/${name}`
}
