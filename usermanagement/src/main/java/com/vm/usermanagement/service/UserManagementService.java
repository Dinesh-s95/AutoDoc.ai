package com.vm.usermanagement.service;

import com.vm.usermanagement.client.IdentityProviderClient;
import com.vm.usermanagement.client.VehicleManagementClient;
import com.vm.usermanagement.entity.MobilityUser;
import com.vm.usermanagement.repository.UserManagementRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class UserManagementService {

    @Autowired
    private IdentityProviderClient identityProvider;

    @Autowired
    private VehicleManagementClient vehicleClient;

    @Autowired
    private UserManagementRepository repo;

    public String onboardUser(String username, String password) {
        Map<String, Object> loginResponse = identityProvider.login(Map.of("username", username, "password", password));
        if (loginResponse.containsKey("token")) {
            String mobilityUserId = "MOB-" + UUID.randomUUID();
            MobilityUser user = new MobilityUser();
            user.setUsername(username);
            user.setMobilityUserId(mobilityUserId);
            repo.save(user);
            return mobilityUserId;
        }
        throw new RuntimeException("Login failed");
    }

    public void assignVehicleToUser(String username, String vin, String brand, String country) {
        String result = vehicleClient.verifyVehicle(vin, brand, country);
        Optional<MobilityUser> userOpt = repo.findByUsername(username);
        if (userOpt.isPresent() && result.contains("Vehicle is registered")) {
            MobilityUser user = userOpt.get();
            user.setVin(vin);
            repo.save(user);
        } else {
            throw new RuntimeException("Vehicle not registered or user not found");
        }
    }

    public Optional<MobilityUser> getUserByUsername(String username) {
        return repo.findByUsername(username);
    }
}
