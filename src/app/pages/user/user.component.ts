import { Component, effect } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AccountCoreService } from '@services';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-user',
  standalone: true,
  imports: [
    RouterModule,
  ],
  templateUrl: './user.component.html',
  styleUrl: './user.component.scss',
})
export class UserComponent {
  private subs_ = new Subscription();

  constructor(
    private readonly accountCore: AccountCoreService,
    private readonly router: Router,
  ) {
    effect(() => {
      if (this.accountCore.logout_$()) {
        this.router.navigate(['/guest']);
        this.subs_.unsubscribe();
      }
    });
  }
}
