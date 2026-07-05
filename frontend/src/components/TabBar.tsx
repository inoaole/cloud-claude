import { NavLink } from 'react-router-dom';
import { TABS } from '../lib/tabs';
import styles from './TabBar.module.css';

export function TabBar() {
  return (
    <nav className={styles.tabbar} aria-label="Primary">
      {TABS.map(({ path, label, Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.on : ''}`}
        >
          <Icon className={styles.ic} />
          <span className={styles.label}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
