import { Routes, Route, Navigate } from 'react-router-dom'
import { ClipboardList, Globe } from 'lucide-react'

import PublicLayout from '../layouts/PublicLayout'
import AdminLayout from '../layouts/AdminLayout'
import MpdcLayout from '../layouts/MpdcLayout'
import EngineeringLayout from '../layouts/EngineeringLayout'
import BacLayout from '../layouts/BacLayout'
import ProtectedRoute from '../components/ProtectedRoute'

import PublicProjects from '../pages/public/PublicProjects'
import Login from '../pages/Login'
import ResetPassword from '../pages/ResetPassword'
import Unauthorized from '../pages/Unauthorized'
import NotFound from '../pages/NotFound'
import ComingSoon from '../pages/shared/ComingSoon'
import Messaging from '../pages/shared/Messaging'

import AdminDashboard from '../pages/admin/AdminDashboard'
import StaffAccounts from '../pages/admin/StaffAccounts'
import Offices from '../pages/admin/Offices'
import AdminProjects from '../pages/admin/AdminProjects'
import AdminProjectDetail from '../pages/admin/AdminProjectDetail'
import AuditLog from '../pages/admin/AuditLog'
import MpdcDashboard from '../pages/mpdc/MpdcDashboard'
import MpdcMonitoring from '../pages/mpdc/MpdcMonitoring'
import MpdcProjectMonitoringDetail from '../pages/mpdc/MpdcProjectMonitoringDetail'
import MyProjects from '../pages/mpdc/MyProjects'
import ProjectForm from '../pages/mpdc/ProjectForm'
import EngineeringDashboard from '../pages/engineering/EngineeringDashboard'
import ProjectReview from '../pages/engineering/ProjectReview'
import ProjectReviewDetail from '../pages/engineering/ProjectReviewDetail'
import SiteMonitoring from '../pages/engineering/SiteMonitoring'
import ProjectMonitoringDetail from '../pages/engineering/ProjectMonitoringDetail'
import BacDashboard from '../pages/bac/BacDashboard'
import BacProcurement from '../pages/bac/BacProcurement'
import BacProcurementDetail from '../pages/bac/BacProcurementDetail'
import BacContractors from '../pages/bac/BacContractors'
import BacContractorDetail from '../pages/bac/BacContractorDetail'

import { ROLES } from '../utils/roles'

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public dashboard temporarily disabled — "/" redirects to /login
          while staff role testing is underway. PublicHome.jsx is untouched;
          just point this back at PublicHome to restore it. */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route element={<PublicLayout />}>
        <Route path="/projects" element={<PublicProjects />} />
      </Route>

      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="projects" element={<AdminProjects />} />
        <Route path="projects/:projectId" element={<AdminProjectDetail />} />
        <Route path="staff" element={<StaffAccounts />} />
        <Route path="offices" element={<Offices />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="messaging" element={<Messaging />} />
      </Route>

      <Route
        path="/mpdc"
        element={
          <ProtectedRoute allowedRoles={[ROLES.MPDC]}>
            <MpdcLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<MpdcDashboard />} />
        <Route path="projects" element={<MyProjects />} />
        <Route path="projects/new" element={<ProjectForm />} />
        <Route path="projects/:projectId" element={<ProjectForm />} />
        <Route path="monitoring" element={<MpdcMonitoring />} />
        <Route path="monitoring/:projectId" element={<MpdcProjectMonitoringDetail />} />
        <Route path="messaging" element={<Messaging />} />
        <Route
          path="published"
          element={
            <ComingSoon
              title="Published Projects"
              description="Manage what's visible on the public site."
              icon={Globe}
              breadcrumbs={[{ label: 'Dashboard', to: '/mpdc' }, { label: 'Published Projects' }]}
            />
          }
        />
      </Route>

      <Route
        path="/engineering"
        element={
          <ProtectedRoute allowedRoles={[ROLES.ENGINEERING]}>
            <EngineeringLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<EngineeringDashboard />} />
        <Route path="review" element={<ProjectReview />} />
        <Route path="review/:projectId" element={<ProjectReviewDetail />} />
        <Route path="monitoring" element={<SiteMonitoring />} />
        <Route path="monitoring/:projectId" element={<ProjectMonitoringDetail />} />
        <Route path="messaging" element={<Messaging />} />
      </Route>

      <Route
        path="/bac"
        element={
          <ProtectedRoute allowedRoles={[ROLES.BAC]}>
            <BacLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<BacDashboard />} />
        <Route path="procurement" element={<BacProcurement />} />
        <Route path="procurement/:projectId" element={<BacProcurementDetail />} />
        <Route path="contractors" element={<BacContractors />} />
        <Route path="contractors/:contractorId" element={<BacContractorDetail />} />
        <Route path="messaging" element={<Messaging />} />
        <Route
          path="accomplishments"
          element={
            <ComingSoon
              title="Accomplishments"
              description="Contractor billing and accomplishment submissions."
              icon={ClipboardList}
              breadcrumbs={[{ label: 'Dashboard', to: '/bac' }, { label: 'Accomplishments' }]}
            />
          }
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
