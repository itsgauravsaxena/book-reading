import Foundation

// MARK: - Auth

struct AuthUser: Equatable {
    let id: String
    let email: String?
}

enum AuthState: Equatable {
    case signedOut
    case signedIn(AuthUser)
}

protocol AuthService: AnyObject {
    var state: AuthState { get }
    func signInWithApple(idToken: String, nonce: String) async throws -> AuthUser
    func signInWithEmail(_ email: String, password: String) async throws -> AuthUser
    func signUpWithEmail(_ email: String, password: String) async throws -> AuthUser
    func signOut() async throws
}

// MARK: - Sync

/// Plain data transfer objects sent to / received from the backend.
/// These mirror the Core Data entities but are decoupled from the managed object context.
struct BookDTO: Codable, Identifiable {
    let id: UUID
    var title: String
    var authors: String?
    var isbn: String?
    var coverURL: String?
    var pageCount: Int
    var currentPage: Int
    var source: String?
    var externalId: String?
    var addedAt: Date
    var finishedAt: Date?
}

struct ReadingSessionDTO: Codable, Identifiable {
    let id: UUID
    var bookId: UUID
    var startedAt: Date
    var endedAt: Date
    var durationSeconds: Int
    var pagesRead: Int
    var dayKey: String
}

struct DailyGoalDTO: Codable, Identifiable {
    let id: UUID
    var minutesPerDay: Int
    var effectiveFrom: Date
}

protocol SyncService: AnyObject {
    func push(books: [BookDTO], sessions: [ReadingSessionDTO], goals: [DailyGoalDTO]) async throws
    func pull(since: Date?) async throws -> (books: [BookDTO], sessions: [ReadingSessionDTO], goals: [DailyGoalDTO])
}

// MARK: - Local-only default

/// No-op implementations so the app is fully functional offline today.
/// Swap these for Supabase-backed versions once the project is on Xcode 15+
/// (supabase-swift requires Swift 5.9). Wiring steps:
///   1. Add the `supabase-swift` Swift Package dependency to the Paged target.
///   2. Implement `SupabaseAuthService: AuthService` using `auth.signInWithIdToken` (Apple)
///      and `auth.signIn(email:password:)`.
///   3. Implement `SupabaseSyncService: SyncService` against tables `books`,
///      `reading_sessions`, `daily_goals`, each with a `user_id` column and Row Level
///      Security policy `user_id = auth.uid()`.
///   4. Map Core Data entities <-> the *DTO types above in a repository layer.
final class LocalOnlyAuthService: AuthService {
    private(set) var state: AuthState = .signedOut

    func signInWithApple(idToken: String, nonce: String) async throws -> AuthUser {
        let user = AuthUser(id: "local-apple", email: nil)
        state = .signedIn(user)
        return user
    }
    func signInWithEmail(_ email: String, password: String) async throws -> AuthUser {
        let user = AuthUser(id: "local-email", email: email)
        state = .signedIn(user)
        return user
    }
    func signUpWithEmail(_ email: String, password: String) async throws -> AuthUser {
        try await signInWithEmail(email, password: password)
    }
    func signOut() async throws { state = .signedOut }
}

final class LocalOnlySyncService: SyncService {
    func push(books: [BookDTO], sessions: [ReadingSessionDTO], goals: [DailyGoalDTO]) async throws {}
    func pull(since: Date?) async throws -> (books: [BookDTO], sessions: [ReadingSessionDTO], goals: [DailyGoalDTO]) {
        ([], [], [])
    }
}
