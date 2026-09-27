import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';

/**
 * Requests service for HTTP API communication with credentials and type safety.
 * 
 * HTTP request service providing typed API communication methods for GET, POST, PATCH,
 * and DELETE operations with automatic credential handling. Features type-safe request
 * methods with generic type parameters, automatic cookie/credential inclusion for
 * authentication, and support for query parameters. Provides centralized HTTP client
 * wrapper for consistent API communication across the application with proper
 * credential management for secure backend integration.
 */
@Injectable({
  providedIn: 'root'
})
export class RequestsService {
  constructor(private http: HttpClient) { } 

  // GET request method
  Get<T>(url: string, params?: HttpParams) {
    return this.http.get<T>(url, {params, withCredentials: true });
  }

  // POST request method
  Post<T>(url: string, body: any, params?: HttpParams) {
    return this.http.post<T>(url, body, {params, withCredentials: true });
  }

  // PATCH request method
  Patch<T>(url: string, body?: any, params?: HttpParams) {
    return this.http.patch<T>(url, body, {params, withCredentials: true });
  }

  // DELETE request method
  Delete<T>(url: string, body?: any, params?: HttpParams) {
    return this.http.delete<T>(url, {body, params, withCredentials: true });
  }
}
