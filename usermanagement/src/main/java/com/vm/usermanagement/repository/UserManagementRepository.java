package com.vm.usermanagement.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import com.vm.usermanagement.entity.MobilityUser;

public interface UserManagementRepository extends JpaRepository<MobilityUser, Long> {
    Optional<MobilityUser> findByUsername(String username);
}
