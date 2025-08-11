package com.vm.enrollment.service;

import com.vm.enrollment.client.UserManagementClient;
import com.vm.enrollment.dto.UserResponseDTO;
import com.vm.enrollment.entity.Enrollment;
import com.vm.enrollment.repository.EnrollmentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class EnrollmentService {

    @Autowired
    private UserManagementClient userClient;

    @Autowired
    private EnrollmentRepository repo;

    public String nominatePrimaryUser(String username) {
        UserResponseDTO user = userClient.getUser(username);
        if (user.getVin() != null) {
            Enrollment enrollment = new Enrollment();
            enrollment.setUsername(username);
            enrollment.setVin(user.getVin());
            enrollment.setRole("PRIMARY_USER");
            repo.save(enrollment);
            return "User nominated as PRIMARY_USER";
        } else {
            throw new RuntimeException("User is not associated with any vehicle");
        }
    }

    public String nominateSecondaryUser(String username) {
        UserResponseDTO user = userClient.getUser(username);
        if (user.getVin() != null) {
            Enrollment enrollment = new Enrollment();
            enrollment.setUsername(username);
            enrollment.setVin(user.getVin());
            enrollment.setRole("SECONDARY_USER");
            repo.save(enrollment);
            return "User nominated as SECONDARY_USER";
        } else {
            throw new RuntimeException("User is not associated with any vehicle");
        }
    }
}
