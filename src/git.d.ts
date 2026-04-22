/*---------------------------------------------------------------------------------------------
 *  Git Extension API Type Definitions
 *  Sourced from: vscode/extensions/git/src/api/git.d.ts (MIT License, Microsoft Corporation)
 *  Trimmed to only the members used by Stasher.
 *--------------------------------------------------------------------------------------------*/

import { Uri, Event, Disposable, ProviderResult } from 'vscode';
import { Status } from './gitEnums';

export { ProviderResult, Status };

export interface Git {
  readonly path: string;
}

export interface InputBox {
  value: string;
}

export const enum ForcePushMode {
  Force,
  ForceWithLease,
  ForceWithLeaseIfIncludes,
}

export const enum RefType {
  Head,
  RemoteHead,
  Tag,
}

export interface Ref {
  readonly type: RefType;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

export interface Branch extends Ref {
  readonly upstream?: UpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface Change {
  /**
   * Returns either `originalUri` or `renameUri`, depending
   * on whether this change is a rename change. When
   * in doubt always use `uri` over the other two alternatives.
   */
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly renameUri: Uri | undefined;
  readonly status: Status;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  readonly remotes: Remote[];
  readonly submodules: Submodule[];
  readonly rebaseCommit: Commit | undefined;
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly onDidChange: Event<void>;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
}

export interface BranchQuery {
  readonly remote?: boolean;
  readonly pattern?: string;
  readonly count?: number;
  readonly contains?: string;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly inputBox: InputBox;
  readonly state: RepositoryState;
  readonly ui: RepositoryUIState;

  getConfigs(): Promise<{ key: string; value: string }[]>;
  getConfig(key: string): Promise<string>;
  setConfig(key: string, value: string): Promise<string>;
  getGlobalConfig(key: string): Promise<string>;

  getObjectDetails(treeish: string, path: string): Promise<{ mode: string; object: string; size: number }>;
  detectObjectType(object: string): Promise<{ mimetype: string; encoding?: string }>;
  buffer(ref: string, path: string): Promise<Buffer>;
  show(ref: string, path: string): Promise<string>;
  getCommit(ref: string): Promise<Commit>;

  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  clean(paths: string[]): Promise<void>;

  apply(patch: string, reverse?: boolean): Promise<void>;
  diff(cached?: boolean): Promise<string>;
  diffWithHEAD(): Promise<Change[]>;
  diffWithHEAD(path: string): Promise<string>;
  diffWith(ref: string): Promise<Change[]>;
  diffWith(ref: string, path: string): Promise<string>;
  diffIndexWithHEAD(): Promise<Change[]>;
  diffIndexWithHEAD(path: string): Promise<string>;
  diffIndexWith(ref: string): Promise<Change[]>;
  diffIndexWith(ref: string, path: string): Promise<string>;
  diffBetween(ref1: string, ref2: string): Promise<Change[]>;
  diffBetween(ref1: string, ref2: string, path: string): Promise<string>;

  hashObject(data: string): Promise<string>;

  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  getBranch(name: string): Promise<Branch>;
  getBranches(query: BranchQuery, cancellationToken?: import('vscode').CancellationToken): Promise<Ref[]>;
  setBranchUpstream(name: string, upstream: string): Promise<void>;

  getRefs(query: BranchQuery, cancellationToken?: import('vscode').CancellationToken): Promise<Ref[]>;

  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;

  tag(name: string, upstream: string): Promise<void>;
  deleteTag(name: string): Promise<void>;

  status(): Promise<void>;
  checkout(treeish: string): Promise<void>;

  addRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  renameRemote(name: string, newName: string): Promise<void>;

  fetch(options?: { remote?: string; ref?: string; all?: boolean; prune?: boolean; depth?: number }): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;

  blame(path: string): Promise<string>;
  log(options?: { maxEntries?: number; path?: string; range?: string; reverse?: boolean; sortByAuthorDate?: boolean }): Promise<Commit[]>;

  commit(message: string, opts?: CommitOptions): Promise<void>;

  createStash(options?: { message?: string; includeUntracked?: boolean; staged?: boolean }): Promise<void>;
  popStash(index?: number): Promise<void>;
  dropStash(index?: number): Promise<void>;
  applyStash(index?: number): Promise<void>;
}

export interface RepositoryUIState {
  readonly selected: boolean;
  readonly onDidChange: Event<void>;
}

export interface CommitOptions {
  all?: boolean | 'tracked';
  amend?: boolean;
  signoff?: boolean;
  signCommit?: boolean;
  empty?: boolean;
  noVerify?: boolean;
  requireUserConfig?: boolean;
  useEditor?: boolean;
  verbose?: boolean;
  postCommitCommand?: string | null;
}

export const enum GitErrorCodes {
  BadConfigFile = 'BadConfigFile',
  AuthenticationFailed = 'AuthenticationFailed',
  NoUserNameConfigured = 'NoUserNameConfigured',
  NoUserEmailConfigured = 'NoUserEmailConfigured',
  NoRemoteRepositorySpecified = 'NoRemoteRepositorySpecified',
  NotAGitRepository = 'NotAGitRepository',
  NotAtRepositoryRoot = 'NotAtRepositoryRoot',
  Conflict = 'Conflict',
  StashConflict = 'StashConflict',
  UnmergedChanges = 'UnmergedChanges',
  PushRejected = 'PushRejected',
  ForcePushWithLeaseRejected = 'ForcePushWithLeaseRejected',
  ForcePushWithLeaseIfIncludesRejected = 'ForcePushWithLeaseIfIncludesRejected',
  RemoteConnectionError = 'RemoteConnectionError',
  DirtyWorkTree = 'DirtyWorkTree',
  CantOpenResource = 'CantOpenResource',
  GitNotFound = 'GitNotFound',
  CantCreatePipe = 'CantCreatePipe',
  PermissionDenied = 'PermissionDenied',
  CantAccessRemote = 'CantAccessRemote',
  RepositoryNotFound = 'RepositoryNotFound',
  RepositoryIsLocked = 'RepositoryIsLocked',
  BranchNotFullyMerged = 'BranchNotFullyMerged',
  NoRemoteReference = 'NoRemoteReference',
  InvalidBranchName = 'InvalidBranchName',
  BranchAlreadyExists = 'BranchAlreadyExists',
  NoLocalChanges = 'NoLocalChanges',
  NoStashFound = 'NoStashFound',
  LocalChangesOverwritten = 'LocalChangesOverwritten',
  NoUpstreamBranch = 'NoUpstreamBranch',
  IsInSubmodule = 'IsInSubmodule',
  WrongCase = 'WrongCase',
  CantLockRef = 'CantLockRef',
  CantRebaseMultipleBranches = 'CantRebaseMultipleBranches',
  PatchDoesNotApply = 'PatchDoesNotApply',
  NoPathFound = 'NoPathFound',
  UnknownPath = 'UnknownPath',
  EmptyCommitMessage = 'EmptyCommitMessage',
  BranchFastForwardRejected = 'BranchFastForwardRejected',
  TagAlreadyExists = 'TagAlreadyExists',
  CommitNoStagingArea = 'CommitNoStagingArea',
}

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}

export const enum APIState {
  Uninitialized = 'uninitialized',
  Initialized = 'initialized',
}

export interface PublishEvent {
  branch: string;
  repository: Repository;
}

export interface API {
  readonly state: APIState;
  readonly onDidChangeState: Event<APIState>;
  readonly onDidPublish: Event<PublishEvent>;
  readonly git: Git;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;

  toGitUri(uri: Uri, ref: string): Uri;
  getRepository(uri: Uri): Repository | null;
  init(root: Uri): Promise<Repository | null>;
  openRepository(root: Uri): Promise<Repository | null>;

  registerRemoteSourcePublisher?(publisher: RemoteSourcePublisher): Disposable;
  registerRemoteSourceProvider?(provider: RemoteSourceProvider): Disposable;
  registerCredentialsProvider?(provider: CredentialsProvider): Disposable;
  registerPostCommitCommandsProvider?(provider: PostCommitCommandsProvider): Disposable;
}

export interface RemoteSourceProvider {
  readonly name: string;
  readonly icon?: string;
  readonly supportsQuery?: boolean;
  getRemoteSources(query?: string): ProviderResult<RemoteSource[]>;
  getBranches?(url: string): ProviderResult<string[]>;
}

export interface RemoteSourcePublisher {
  readonly name: string;
  readonly icon?: string;
  publishRepository(repository: Repository): Promise<void>;
}

export interface RemoteSource {
  readonly name: string;
  readonly description?: string;
  readonly url: string | string[];
}

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

export interface CredentialsProvider {
  getCredentials(host: Uri): ProviderResult<Credentials>;
}

export interface PostCommitCommandsProvider {
  getCommands(repository: Repository): Command[];
}

export interface Command {
  command: string;
  title: string;
  tooltip?: string;
  arguments?: unknown[];
}
